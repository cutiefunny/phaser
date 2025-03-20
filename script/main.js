//페이지 시작 시 수행되는 함수
window.onload = function(){
    //machineId가 없으면 생성
    if (!localStorage.getItem('machineId')) {
        let machineId = Math.random().toString(36).substr(2, 8);
        localStorage.setItem('machineId', machineId);
    }
    //$("#machineId").text(localStorage.getItem('machineId'));
    //카카오톡 인앱 브라우저일 경우 외부 브라우저로 이동
    if(navigator.userAgent.match(/kakaotalk/i)){
        location.href = 'kakaotalk://web/openExternal?url='+encodeURIComponent(target_url);
    }
};

//#region pwa 관련

if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      navigator.serviceWorker.register('service-worker.js')
        .then(reg => {
          console.log('Service worker registered! 😎', reg);
        })
        .catch(err => {
          console.log('😥 Service worker registration failed: ', err);
        });
    });
  }

let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showInstallPromotion();
});

function showInstallPromotion() {
    // Display your custom install prompt
    const installButton = document.getElementById('installButton');
    installButton.style.display = 'inline';
}

function installApp(){
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === 'accepted') {
            console.log('User accepted the install prompt');
        } else {
            console.log('User dismissed the install prompt');
        }
        deferredPrompt = null;
    });
}

//카카오톡 인앱에서 외부 브라우저 실행

var inappdeny_exec_vanillajs = (callback) => {
    if(document.readyState !== 'loading'){
        callback();
    }else{
        document.addEventListener('DOMContentLoaded', callback);
    } 
};

inappdeny_exec_vanillajs(() => { 
    /* Do things after DOM has fully loaded */ 
    function copytoclipboard(val){
        var t = document.createElement("textarea");
        document.body.appendChild(t);
        t.value = val;
        t.select();
        document.execCommand('copy');
        document.body.removeChild(t);
    };
    function inappbrowserout(){
        copytoclipboard(window.location.href);
        alert('URL주소가 복사되었습니다.\n\nSafari가 열리면 주소창을 길게 터치한 뒤, "붙여놓기 및 이동"를 누르면 정상적으로 이용하실 수 있습니다.');
        location.href='x-web-search://?';
    };

    var useragt = navigator.userAgent.toLowerCase();
    var target_url = location.href;
    
    if(useragt.match(/kakaotalk/i)){
        
        //카카오톡 외부브라우저로 호출
        location.href = 'kakaotalk://web/openExternal?url='+encodeURIComponent(target_url);
        
    }else if(useragt.match(/line/i)){
        
        //라인 외부브라우저로 호출
        if(target_url.indexOf('?') !== -1){
            location.href = target_url+'&openExternalBrowser=1';
        }else{
            location.href = target_url+'?openExternalBrowser=1';
        }
        
    }else if(useragt.match(/inapp|naver|snapchat|wirtschaftswoche|thunderbird|instagram|everytimeapp|whatsApp|electron|wadiz|aliapp|zumapp|iphone(.*)whale|android(.*)whale|kakaostory|band|twitter|DaumApps|DaumDevice\/mobile|FB_IAB|FB4A|FBAN|FBIOS|FBSS|trill|SamsungBrowser\/[^1]/i)){
        
        //그외 다른 인앱들
        if(useragt.match(/iphone|ipad|ipod/i)){
            
            //아이폰은 강제로 사파리를 실행할 수 없다 ㅠㅠ
            //모바일대응뷰포트강제설정
            var mobile = document.createElement('meta');
            mobile.name = 'viewport';
            mobile.content = "width=device-width, initial-scale=1, shrink-to-fit=no, user-scalable=no, minimal-ui";
            document.getElementsByTagName('head')[0].appendChild(mobile);
            //노토산스폰트강제설정
            var fonts = document.createElement('link');
            fonts.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@100;300;400;500;700;900&display=swap';
            document.getElementsByTagName('head')[0].appendChild(fonts);
            document.body.innerHTML = "<style>body{margin:0;padding:0;font-family: 'Noto Sans KR', sans-serif;overflow: hidden;height: 100%;}</style><h2 style='padding-top:50px; text-align:center;font-family: 'Noto Sans KR', sans-serif;'>인앱브라우저 호환문제로 인해<br />Safari로 접속해야합니다.</h2><article style='text-align:center; font-size:17px; word-break:keep-all;color:#999;'>아래 버튼을 눌러 Safari를 실행해주세요<br />Safari가 열리면, 주소창을 길게 터치한 뒤,<br />'붙여놓기 및 이동'을 누르면<br />정상적으로 이용할 수 있습니다.<br /><br /><button onclick='inappbrowserout();' style='min-width:180px;margin-top:10px;height:54px;font-weight: 700;background-color:#31408E;color:#fff;border-radius: 4px;font-size:17px;border:0;'>Safari로 열기</button></article><img style='width:70%;margin:50px 15% 0 15%' src='https://tistory3.daumcdn.net/tistory/1893869/skin/images/inappbrowserout.jpeg' />";
        
        }else{
            //안드로이드는 Chrome이 설치되어있음으로 강제로 스킴실행한다.
            location.href='intent://'+target_url.replace(/https?:\/\//i,'')+'#Intent;scheme=http;package=com.android.chrome;end';
        }
    }
});

//#endregion

function getTitle(){
    var num = Math.floor((Math.random() * 5)) + 1;
    var titleNum = "/images/"+num+".png";
    document.getElementById("title").setAttribute("src",titleNum);
}