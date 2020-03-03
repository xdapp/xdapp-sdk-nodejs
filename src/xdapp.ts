import tls from "tls";
import net from "net";
import fetch from "node-fetch";
import hprose from "hprose";
import FormData from "form-data";
import { parse } from "url";
import debug from "debug";
import SysService from "./sysService";

const debugXD = debug("xdapp:sdk");

const hproseService = hprose.Service;
const Future = hprose.Future;

const ProductionServer = {
  host: "service-prod.xdapp.com",
  port: 8900
};
const DevServer = {
  host: "dev.xdapp.com",
  port: 8100
};
const GlobalServer = {
  host: "service-gcp.xdapp.com",
  port: 8900
};

const RPC_VERSION = 1; // RPC协议版本
const FLAG_RESULT_MODE = 2; // 返回模式
const FLAG_FINISH = 4; // 已完成

type ConnectOption = {
  tls: boolean;
  localDev: boolean;
  dev: boolean;
};

class XDAppServiceAgent extends hproseService {
  private showLog: boolean;
  private serviceName: string;
  private appName: string;
  constructor(appName: string, serviceName: string, serviceKey = "") {
    if (!appName) {
      throw new Error("Required appName");
    }
    if (!serviceName) {
      throw new Error("Required serviceName");
    }
    super();
    this.showLog = false;
    this.serviceName = serviceName;
    this.appName = appName;

    // 注册系统服务
    this.addInstanceMethods(
      SysService(this, appName, serviceName, serviceKey),
      "sys"
    );
  }

  addHttpApiProxy(
    url: string,
    alias = "api",
    methods = ["get"]
  ) {
    const self = this;
    if (typeof methods === "string") methods = [methods];
    methods.forEach(function(method) {
      self.addWebFunction(
        function(uri: string, data?: any, timeout: number = 30, callback?: (response: any) => void) {
          const context = self.getCurrentContext();

          let urlParse = parse(url + uri);
          const options = {
            uri: urlParse,
            method: method.toUpperCase(),
            timeout: timeout * 1000,
            encoding: "utf8",
            gzip: true,
            headers: {
              // 'Host': urlParse.hostname,
              "User-Agent": "Chrome/49.0.2587.3",
              "X-Xdapp-Proxy": "True",
              "X-Xdapp-App-Id": context.appId,
              "X-Xdapp-Service": self.serviceName,
              "X-Xdapp-Request-Id": context.requestId,
              "X-Xdapp-Admin-Id": context.adminId,
              "Content-Type": "application/x-www-form-urlencoded"
            },
            body: ""
          };

          if (options.method === "POST") {
            options.body =
              typeof data === "object" ? new FormData(data) : data.toString();
          } else if (options.method === "PUT") {
            options.body =
              typeof data === "object" ? JSON.stringify(data) : "" + data;
          }

          // TODO: 不确定是否一定为 json
          fetch(urlParse, options)
            .then(x => x.json())
            .then(resp => {
              const response = {
                code: resp.status,
                headers: resp.headers || {},
                body: resp.body
              };

              if (!resp) {
                response.code = -1;
              }

              debugXD(
                "Http Proxy, method: " +
                  method +
                  ", code: " +
                  resp.statusCode +
                  ", url: " +
                  url +
                  uri +
                  ", headers: " +
                  JSON.stringify(resp.headers || {})
              );
              return callback && callback(response);
            });
        },
        alias + "_" + method,
        { async: true }
      );
    });
  }

  // 注册一个Web浏览器可用的方法，同 hprose.addFunction 方法参数，差别是默认增加了 alias 了 serviceName 的前缀
  addWebFunction(func: (uri: string, data?: any, timeout?: number, callback?: () => void) => void, alias: string, options: any) {
    alias = this.serviceName + "_" + alias;
    this.addFunction(func, alias, options);
  }

  // deprecated 请使用 addWebFunction
  register(func: () => void, alias: string, options: any) {
    this.addWebFunction(func, alias, options);
  }

  // 获取当前上下文对象
  getCurrentContext() {
    return this._lastContext;
  }

  // 连接到本地测试环境
  connectToLocalDev(host = "127.0.0.1", port = 8061) {
    return this.connectTo(host, port, {
      tls: false,
      localDev: true,
      dev: true
    });
  }

  // 连接到测试环境
  connectToDev() {
    return this.connectTo(null, null, {
      tls: true,
      localDev: false,
      dev: true
    });
  }

  // 连接到国内生产环境
  connectToProduce() {
    return this.connectTo(null, null, {
      tls: true,
      localDev: false,
      dev: false
    });
  }
  // 连接到海外生产环境
  connectToGlobal() {
    return this.connectTo(GlobalServer.host, GlobalServer.port, {
      tls: true,
      localDev: false,
      dev: false
    });
  }

  // 创建一个新的连接
  connectTo(host: string | null, port: number | null, option: ConnectOption) {
    if (this.socket) return false;

    option = Object.assign(
      {
        tls: true,
        localDev: false,
        dev: false,
        serviceKey: null
      },
      option || {}
    );

    host = host || (option.dev ? DevServer.host : ProductionServer.host);
    port = port || (option.dev ? DevServer.port : ProductionServer.port);

    const socket = (option.tls ? tls : (net as any)).connect(
      port,
      host,
      {},
      (err: any) => {
          debugXD(port, host, err)
        debugXD(
          "Rpc client connected. " +
            (socket.authorized ? "authorized" : "unauthorized")
        );
      }
    );
    socket.on("data", (data: Buffer) => {
      // CFlag/CVer/NLength/NAppId/NServiceId/NRequestId/NAdminId/CContextLength
      if (data.length < 20) {
        debugXD(`接收到的数据包异常`);
        socket.end();
        return;
      }
      const flag = data.readInt8(0);
      const ver = data.readInt8(1);
      if (ver !== RPC_VERSION) {
        debugXD(`当前协议版本不被支持 ${ver}`);
        socket.end();
        return;
      }

      const length = data.readInt32BE(2);
      const contextLength = data.readInt8(22);
      const request = {
        flag: flag,
        ver: ver,
        length: length,
        appId: data.readInt32BE(6),
        serviceId: data.readInt32BE(10),
        requestId: data.readInt32BE(14),
        adminId: data.readInt32BE(18),
        contextLength: contextLength,
        context: contextLength > 0 ? data.slice(23, 23 + contextLength) : "",
        body: data.slice(contextLength + 23)
      };

      const context = {
        service: this,
        client: socket,
        requestId: request.requestId,
        appId: request.appId,
        serviceId: request.serviceId,
        adminId: request.adminId,
        userdata: {}
      };
      this._lastContext = context;
      const rs = this.defaultHandle(request.body.toString(), context);

      if (Future.isFuture(rs)) {
        rs.then(function(data: Buffer) {
          _send(socket, data, request);
        });
      } else {
        _send(socket, data, request);
      }
    });
    socket.on("error", (error: Error) => {
      debugXD("socket error: ", error);
      this.socket = null;
      this.regSuccess = false;

      if (!this.isRegError) {
        setTimeout(() => {
          // isRegError
          this.connectTo(host, port, option);
        }, 2000);
      }
    });
    socket.on("close", () => {
      debugXD(
        "Rpc server close connection" +
          (this.isRegError ? "" : ", reconnect after 1 second.")
      );
      this.socket = null;
      this.regSuccess = false;

      if (!this.isRegError) {
        setTimeout(() => {
          // isRegError
          this.connectTo(host, port, option);
        }, 1000);
      }
    });

    // // 超时重置
    // socket.setTimeout(30 * 1000);
    // socket.on('timeout', () => {
    //     this.log('Rpc socket timeout.');
    //     socket.end();
    // });

    function _send(socket: any, body: any, request: any) {
      // CFlag/CVer/NLength/NAppId/NServiceId/NRequestId/NAdminId/CContextLength
      const packagePrefix = 6;
      const headerLength = 17;
      const length = headerLength + request.contextLength + body.length;

      const bufHeader = Buffer.alloc(packagePrefix + headerLength);
      // packagePrefix
      const flag = request.flag | FLAG_RESULT_MODE | FLAG_FINISH;
      bufHeader.writeInt8(flag, 0); // flag
      bufHeader.writeInt8(RPC_VERSION, 1); // ver
      bufHeader.writeInt32BE(length, 2); // length
      // header
      bufHeader.writeInt32BE(request.appId, 6); // appId
      bufHeader.writeInt32BE(request.serviceId, 10); // serviceId
      bufHeader.writeInt32BE(request.requestId, 14); // requestId
      bufHeader.writeInt32BE(request.adminId, 18); // adminId
      bufHeader.writeInt8(request.contextLength, 22); // contextLength

      const buffers = [bufHeader];
      if (request.contextLength > 0) {
        // 将自定义内容加入
        buffers.push(request.context);
      }
      buffers.push(body);
      const buf = Buffer.concat(
        buffers,
        bufHeader.length + request.contextLength + body.length
      );
      socket.write(buf);
    }

    this.socket = socket;
    return socket;
  }

  public log(msg: string) {
      debugXD(msg)
  }

  // TODO: 不知道是啥，可能被父方法调用？
  setLogHandle(handle: any) {
    this.log = handle;
  }
}

export default XDAppServiceAgent
