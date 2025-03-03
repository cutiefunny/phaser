//서버IP 조회
exports.getServerIp = function() {
    var os = require('os');
    var ifaces = os.networkInterfaces();
    var result = '';
    for (var dev in ifaces) {
        var alias = 0;
        ifaces[dev].forEach(function(details) {
            if (details.family == 'IPv4' && details.internal === false) {
                result = details.address;
                ++alias;
            }
        });
    }
    return result;
}

//JSON 줄바꿈 함수
exports.jsonEnter = function(json) {return json.replace(/,/gi,",\n").replace(/{/gi,"{\n").replace(/}/gi,"\n}");}