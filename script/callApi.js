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
            $("#header").text("RECORDS");
            let list = json.result;
            console.log("list : "+JSON.stringify(list));
            $("#contents").empty();
            $("#contents").append("<table class='ui celled table' style='text-align:center; margin:0'>");
            $("#contents").append("<thead><tr><th>순위</th><th>이름</th><th>점수</th></tr></thead><tbody>");
            for(var i=0; i<list.length; i++){
                $("#contents").append("<tr><td>"+(i+1)+"</td><td>"+list[i].name+"</td><td>"+list[i].score+"</td></tr>");
            }
            $("#contents").append("</tbody></table>");
            $('#modalCancel').hide();
            $("#modalOk").hide();
            $("#modalClose").show();
            $("#modalClose").click(function(){
                $('.ui.modal').modal('hide');
                location.href = "/";
            });
            $('.ui.modal').modal('show');
            //location.href = json.url
        }else if(json.op == "manualUpdate"){
            $("#header").text("알림");
            $("#contents").text(json.message);
            $("#cancel").hide();
            $('.ui.basic.modal').modal('show');
        }else if(json.op == "sendOTP"){
            $("#otp").val(json.message);
        }else if(json.result == "fail"){
            $("#header").text("오류");
            $("#contents").text(JSON.stringify(json.message));
            $('#cancel').hide();
            $('.ui.basic.modal').modal('show');
            //alert(JSON.stringify(json.message));
        }
    });
}

//a태그 클릭 시 로딩 표시
document.querySelectorAll('a').forEach(function(anchor) {
    anchor.addEventListener('click', function() {
      anchor.classList.add('loading');
    });
});