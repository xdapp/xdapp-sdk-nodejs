# XDApp RPC Service SDK

XDAppRPC服务SDK，使用方法

```js
const xdapp = require('xdapp');

// 其中 demo 为项目名，test 为服务名，123456 为密钥
const service = new xdapp('demo', 'test', '123456');

// 注册一个方法
service.register(function(args) {
    console.log(args);
    return true;
}, 'abc');

// 等同于上面的方法, 其中 test_ 为服务前缀
// 请注意，只有服务名相同的前缀rpc方法才会被外部调用到
service.addFunction(function(args) {
    // 获取 context 对象
    const context = xdapp.getCurrentContext();
    console.log(context.adminId);

    console.log(args);
    return true;
}, 'test_abc');

// 连接到本地测试开发服务器
service.connectToLocalDev('127.0.0.1', 8082);

// 连接到外网测试服务器
// service.connectToDev();

// 连接到生产环境(国内项目)
// service.connectToProduce();

// 连接到生产环境(海外项目)
// service.connectToGlobal();
```

更多的使用方法see: [https://github.com/hprose/hprose-nodejs/wiki/Hprose-服务器](https://github.com/hprose/hprose-nodejs/wiki/Hprose-服务器)



`ServiceAgent` 接受3个参数，分别是应用英文名、服务名和密钥，应用是在 https://www.xdapp.com/ 里创建的应用，服务是在应用后台内自行创建的服务名，密钥是对应每个应用的连接密钥

### 关于 `context` 上下文对象

在RPC请求时，如果需要获取到请求时的管理员ID等等参数，可以用此获取，如上面 `hello` 的例子，通过 `context = xdapp.getCurrentContext()` 可获取到 `context`，包括：

参数         |   说明
------------|---------------------
service     | 当前服务
client      | 通信的连接对象，可以使用 `close()` 方法关闭连接
requestId   | 请求的ID
appId       | 请求的应用ID
serviceId   | 请求发起的服务ID，0表示XDApp系统请求，1表示来自浏览器的请求
adminId     | 请求的管理员ID，0表示系统请求
userdata    | 默认 {} 对象，可以自行设置参数

返回的 `service` 对象常用方法如下：

### `connectToProduce()`

连接到国内生产环境，将会创建一个异步tls连接接受和发送RPC数据，无需自行暴露端口，如果遇到网络问题和服务器断开可以自动重连，除非是因为密钥等问题导致的断开将不会重新连接

### `connectToGlobal()`

连接到海外生产环境，同 `connectToProduce()` 区别在于项目是海外的

### `connectToDev(serviceKey = None)`

同上，连接到研发环境, 不设置 serviceKey 则使用 new ServiceAgent 时传入的密钥

### `connectToLocalDev(self, host = '127.0.0.1', port = 8061, serviceKey = null)`

同上，连接到本地研发服务器，请下载 XDApp-Console-UI 服务包，https://hub000.xindong.com/core-system/xdapp-console-ui ，启动服务



### `addHttpApiProxy(url, alias = 'api', methods = ['get'], array httpHeaders = [])`

添加一个http代理

使用场景：
当服务器里提供一个内部Http接口，但是它没有暴露给外网也没有权限验证处理，但希望Web页面可以使用
此时可以使用此方法，将它暴露成为一个XDApp的RPC服务，在网页里直接通过RPC请求将数据转发到SDK请求后返回，不仅可以实现内网穿透功能还可以在Console后台设置访问权限。

每个Http代理请求都会带以下头信息，方便业务处理:

* X-Xdapp-Proxy: True
* X-Xdapp-App-Id: 1
* X-Xdapp-Service: demo
* X-Xdapp-Request-Id: 1
* X-Xdapp-Admin-Id: 1

```javascript
service.addHttpApiProxy('http://127.0.0.1:9999', 'myApi', ['get', 'post', 'delete', 'put'])
```

Vue页面使用

方法接受3个参数，uri, data, timeout，其中 data 只有在 post 和 put 有效，timeout 默认 30 秒

```javascript
// 其中gm为注册的服务名
this.$service.gm.myApi.get('/uri?a=arg1&b=arg2');
// 最终将会请求 http://127.0.0.1:9999/uri?a=arg1&b=arg2
// 返回对象 {code: 200, headers: {...}, body: '...'}

// 使用post, 第2个参数接受string或字符串, 第3个参数可设置超时
this.$service.gm.myApi.post('/uri?a=1', {a:'arg1', b:'arg2'}, 15);
```

### 同时连接多个环境

一个 `service` 可以同时连接 `connectToProduce`, `connectToDev`, `connectToLocalDev` 3个，但需要保证使用正确的密钥。但不建议将测试环境的连接到生产环境服务器里

### `register(function, alias = null, resultMode = HproseResultMode.Normal, simple = null)`

注册一个RPC方法到服务上，它是 `service.addFunction()` 方法的封装，差别在于会自动对 `alias` 增加 `serviceName` 前缀

`register.register(hello, 'hello')` 相当于 `register.addFunction(hello, 'servicename_hello')`

### `addFunction(function, alias = null, resultMode = HproseResultMode.Normal, simple = null)`

注册一个RPC方法到服务上


### `addMissingFunction(function, resultMode = HproseResultMode.Normal, simple = null)`

此方法注册后，所有未知RPC请求都降调用它，它将传入2个参数，分别是RPC调用名称和参数

### `addFilter() / removeFilter()` 过滤器

可以方便开发调试

see [https://github.com/hprose/hprose-nodejs/wiki/Hprose-过滤器](https://github.com/hprose/hprose-nodejs/wiki/Hprose-过滤器)

## 常见问题

* 使用 addInstanceMethods() 或hprose的方法暴露rpc方法，无法调用方法，提示方法不存在<br>
  不是使用 register() 方法暴露rpc方法，则必须加上服务前缀，例如，应该用 `service.addInstanceMethods(obj, serviceName)`