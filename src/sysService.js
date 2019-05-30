const crypto = require('crypto');

function sha1(str) {
    let hmac = crypto.createHash('sha1');
    hmac.update(str);
    return hmac.digest('hex');
}

// 设置通信配置
const sysService = function (XDAppServiceAgent, appName, serviceName, serviceKey) {
    const sysCall = {};

    function getHash(time, rand) {
        return sha1(`${appName}.${serviceName}.${time}.${rand}.${serviceKey}.xdapp.com`);
    }

    sysCall.reg = function (time, rand, hash) {
        if (XDAppServiceAgent.regSuccess) return false;
        XDAppServiceAgent.isRegError = false;
        if (hash !== sha1(`${time}.${rand}.xdapp.com`)) {
            // 验证失败
            return false;
        }

        const now = parseInt(new Date().getTime() / 1000);
        if (Math.abs(now - time) > 60) {
            // 超时
            return false;
        }

        return {
            'app': appName,
            'name': serviceName,
            'time': now,
            'rand': rand,
            'version': 'v1',
            'hash': getHash(time, rand),
        };
    };

    // 注册失败
    sysCall.regErr = function (msg, data = null) {
        XDAppServiceAgent.log(msg);
        XDAppServiceAgent.isRegError = true;
    }

    // 注册成功
    sysCall.regOk = function(data, time, rand, hash) {
        if (XDAppServiceAgent.regSuccess) return;
        const now = new Date().getTime() / 1000;
        if (Math.abs(now - time) > 60) {
            // 超时
            XDAppServiceAgent.log(`RPC验证超时，服务名: ${appName}->${serviceName}`);
            return false;
        }

        if (getHash(time, rand) !== hash) {
            // 验证失败
            XDAppServiceAgent.log(`RPC验证失败，服务名: ${appName}->${serviceName}`);
            XDAppServiceAgent.socket.close();
            return;
        }

        // 注册成功
        serviceData = data;
        XDAppServiceAgent.regSuccess = true;
        XDAppServiceAgent.serviceId = data.serviceId;

        XDAppServiceAgent.log(`RPC服务注册成功，服务名: ${appName}->${serviceName}`);
    }

    // rpc回调log输出
    sysCall.log = function(log, type, data = null) {
        XDAppServiceAgent.log(log, type, data);
    }

    // ping
    sysCall.ping = function() {
        return true;
    }

    // 获取服务器列表
    sysCall.getFunctions = function() {
        if (!XDAppServiceAgent.regSuccess)return [];
        return XDAppServiceAgent.getNames();
    }

    return sysCall;
}

module.exports = sysService;