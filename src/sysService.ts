import crypto from "crypto";

function sha1(str: string) {
  let hmac = crypto.createHash("sha1");
  hmac.update(str);
  return hmac.digest("hex");
}

function SysService(
  agent: any,
  appName: string,
  serviceName: string,
  serviceKey: string
) {
  function getHash(time: number, rand: string) {
    return sha1(
      `${appName}.${serviceName}.${time}.${rand}.${serviceKey}.xdapp.com`
    );
  }

  return {
    reg(time: number, rand: string, hash: string) {
      if (agent.regSuccess)
        return {
          status: false
        };
      agent.isRegError = false;
      if (hash !== sha1(`${time}.${rand}.xdapp.com`)) {
        // 验证失败
        return {
          status: false
        };
      }

      const now = ~~(new Date().getTime() / 1000);
      if (Math.abs(now - time) > 60) {
        // 超时
        return {
          status: false
        };
      }

      return {
        status: true,
        app: appName,
        name: serviceName,
        time: now,
        rand: rand,
        version: "v1",
        hash: getHash(now, rand)
      };
    },

    regErr(msg: string) {
      agent.log(msg);
      agent.isRegError = true;
    },

    regOk(data: any, time: number, rand: string, hash: string) {
      if (agent.regSuccess) return;
      const now = new Date().getTime() / 1000;
      if (Math.abs(now - time) > 60) {
        // 超时
        agent.log(`RPC验证超时，服务名: ${appName}->${serviceName}`);
        return false;
      }

      // 不接受低于16位长度的rand
      if (rand.length < 16) {
        agent.log(
          `regOk() 回调 rand 参数太短，服务名: ${appName}->${serviceName}`
        );
        return;
      }

      if (getHash(time, rand) !== hash) {
        // 验证失败
        agent.log(`RPC验证失败，服务名: ${appName}->${serviceName}`);
        agent.socket.close();
        return;
      }

      // 注册成功
      // serviceData = data;
      agent.regSuccess = true;
      agent.serviceId = data.serviceId;

      agent.log(`RPC服务注册成功，服务名: ${appName}->${serviceName}`);

      let allService: any = {
        sys: [],
        service: [],
        other: []
      };
      agent.getNames().forEach((item: string) => {
        if (item === "#") return null;
        let pos = item.indexOf("_");
        if (pos === -1) {
          allService.other.push(item);
          return null;
        }
        let type = item.substr(0, pos);
        let func = item.substr(pos + 1);
        switch (type) {
          case "sys":
            allService.sys.push(func.replace(/_/g, ".") + "()");
            break;
          case serviceName:
            allService.service.push(func.replace(/_/g, ".") + "()");
            break;
          default:
            allService.other.push(func.replace(/_/g, ".") + "()");
            break;
        }
      });
      agent.log(`系统RPC：${allService.sys.join(", ")}`);
      agent.log(`已暴露服务RPC：${allService.service.join(", ")}`);
      if (allService.other.length > 0) {
        agent.log(`已暴露但XDApp不会调用的RPC：${allService.other.join(", ")}`);
        agent.log(
          `若需要这些方法暴露给XDApp服务使用，请加: ${serviceName} 前缀`
        );
      }
    },

    // rpc回调log输出
    log(log: any, type: any, data = null) {
      agent.log(log, type, data);
    },

    // ping
    ping() {
      return true;
    },

    // 获取服务器列表
    getFunctions(): any {
      if (!agent.regSuccess) return [];
      return agent.getNames();
    }
  }
}

export default SysService
