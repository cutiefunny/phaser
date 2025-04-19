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
            $('#scoreList').empty();
            let rank = 0;
            json.result.forEach(function(item) {
                rank++;
                $('#scoreList').append('<tr><td>'+rank+'</td><td>'+item.name+'</td><td>'+item.score+'</td><td>');
            });
        }else if(json.op == "search"){
            $("#resultText").text(json.message);
        }

        $(".loading").removeClass("loading");
    });
}

//a태그 클릭 시 로딩 표시
document.querySelectorAll('a').forEach(function(anchor) {
    anchor.addEventListener('click', function() {
      anchor.classList.add('loading');
    });
});