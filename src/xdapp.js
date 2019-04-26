'use strict';

const tls = require('tls');
const net = require('net');
const util = require('util');
const hprose = require('hprose');
const hproseService = hprose.Service;
const Future = hprose.Future;
const sysService = require('./sysService');

const ProductionServer = {
    host: 'www.xdapp.com',
    port: 8900,
};
const DevServer = {
    host: 'dev.xdapp.com',
    port: 8100
}

const RPC_VERSION = 1;          // RPC协议版本
const FLAG_RESULT_MODE = 2;     // 返回模式
const FLAG_FINISH = 4;          // 已完成

class XDAppServiceAgent {
    constructor(appName, serviceName, serviceKey = '') {
        if (!appName) {
            throw new Error('Required appName');
        }
        if (!serviceName) {
            throw new Error('Required serviceName');
        }
        // 注入 this  初始化 hproseService
        this.showLog = false;
        
        this.log = function(log, type) {
            console.log(log);
        };
        hproseService.call(this);

        // // 注册系统服务
        this.addInstanceMethods(sysService(this, appName, serviceName, serviceKey), 'sys');
    }

    // 注册一个服务方法，同 hprose.addFunction 方法参数，差别是默认增加了 alias 了 serviceName 的前缀
    register(func, alias, options) {
        if (typeof(func) !== 'function') {
            throw new Error('Argument func must be a function');
        }
        if ((options === undefined) && (typeof alias === 'object')) {
            options = alias;
            alias = null;
        }
        options = options || {};
        alias = this.serviceName + '_' + alias;

        this.addFunction(func, alias, options);
    }

    // 获取当前上下文对象
    getCurrentContext() {
        return this._lastContext;
    }

    // 连接到本地测试环境
    connectToLocalDev(host = '127.0.0.1', port = 8061) {
        return this.connectTo(host, port, {
            tls: false,
            localDev: true,
            dev: true,
        });
    }

    // 连接到测试环境
    connectToDev() {
        return this.connectTo(null, null, {
            tls: true,
            localDev: false,
            dev: true,
        });
    }

    // 连接到生产环境
    connectToProduce() {
        return this.connectTo(null, null, {
            tls: true,
            localDev: false,
            dev: false,
        });
    }

    // 创建一个新的连接
    connectTo(host, port, option) {
        if (this.socket)return false;

        option = Object.assign({
            tls: true,
            localDev: false,
            dev: false,
            serviceKey: null
        }, option || {});

        host = host || (option.dev ? ProductionServer.host : DevServer.host);
        port = port || (option.dev ? ProductionServer.port : DevServer.port);

        const socket = (option.tls ? tls : net).connect(port, host, {}, () => {
            this.log('Rpc client connected. ' + (socket.authorized ? 'authorized' : 'unauthorized'));
        });
        socket.on('data', (data) => {
            // CFlag/CVer/NLength/NAppId/NServiceId/NRequestId/NAdminId/CContextLength
            if (data.length < 20) {
                this.log(`接收到的数据包异常`);
                socket.end();
                return;
            }
            const flag = data.readInt8(0);
            const ver  = data.readInt8(1);
            if (ver !== RPC_VERSION)
            {
                this.log(`当前协议版本不被支持 ${ver}`);
                socket.end();
                return;
            }

            const length = data.readInt32BE(2);
            const contextLength = data.readInt8(22);
            const request = {
                flag          : flag,
                ver           : ver,
                length        : length,
                appId         : data.readInt32BE(6),
                serviceId     : data.readInt32BE(10),
                requestId     : data.readInt32BE(14),
                adminId       : data.readInt32BE(18),
                contextLength : contextLength,
                context       : contextLength > 0 ? data.slice(23, 23 + contextLength) : '',
                body          : data.slice(contextLength + 23),
            };

            const context = {
                service : this,
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
                rs.then(function(data) {
                    _send(socket, data, request);
                });
            }
            else {
                _send(socket, data, request);
            }
        });
        socket.on('error', (error) => {
            this.log(error, 'error');
            this.socket = null;
            this.regSuccess = false;

            if (!this.isRegError)setTimeout(() => {
                // isRegError
                this.connectTo(host, port, option);
            }, 2000);
        });
        socket.on('end', () => {
            this.log('Rpc server ends connection' + (this.isRegError ? '' : ', reconnect after 1 second.'));
            this.socket = null;
            this.regSuccess = false;

            if (!this.isRegError)setTimeout(() => {
                // isRegError
                console.log('aaaa');
                this.connectTo(host, port, option);
            }, 1000);
        });

        function _send(socket, body, request) {
            // CFlag/CVer/NLength/NAppId/NServiceId/NRequestId/NAdminId/CContextLength
            const packagePrefix = 6;
            const headerLength = 17;
            const length = headerLength + request.contextLength + body.length;

            const bufHeader = new Buffer.alloc(packagePrefix + headerLength);
            // packagePrefix
            const flag = request.flag | FLAG_RESULT_MODE | FLAG_FINISH;
            bufHeader.writeInt8(flag, 0);                         // flag
            bufHeader.writeInt8(RPC_VERSION, 1);                  // ver
            bufHeader.writeInt32BE(length, 2);                    // length
            // header
            bufHeader.writeInt32BE(request.appId, 6);             // appId
            bufHeader.writeInt32BE(request.serviceId, 10);        // serviceId
            bufHeader.writeInt32BE(request.requestId, 14);        // requestId
            bufHeader.writeInt32BE(request.adminId, 18);          // adminId
            bufHeader.writeInt8(request.contextLength, 22);       // contextLength

            const buffers = [bufHeader];
            if (request.contextLength > 0) {
                // 将自定义内容加入
                buffers.push(request.context);
            }
            buffers.push(body);
            const buf = Buffer.concat(buffers, bufHeader.length + request.contextLength + body.length);
            socket.write(buf);
        }

        this.socket = socket;
        return socket;
    }

    setLogHandle(handle) {
        this.log = handle;
    }
}

// 绑定 hproseService 的方法
util.inherits(XDAppServiceAgent, hproseService);

module.exports = XDAppServiceAgent;