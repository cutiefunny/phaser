//fetch API 호출 함수
function callFetchApi(method, url, data) {
    console.log("callFetchApi : " + method + " / " + url + " / " + data);
    fetch(url, {
        method: method,
        headers: {
            'Content-Type': 'application/json'
        },
        body: data
    }).then(function(response) {
        return response.json();
    }).then(function(json) {
        console.log(json);
        if(json.op == "login"){
            location.href = json.url;
        }else if(json.op == "saveScore"){
            $('#scoreBoard').modal('show');
        }
    });
}

//a태그 클릭 시 로딩 표시
document.querySelectorAll('a').forEach(function(anchor) {
    anchor.addEventListener('click', function() {
      anchor.classList.add('loading');
    });
});