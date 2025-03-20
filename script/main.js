//페이지 시작 시 수행되는 함수
window.onload = function(){
    //machineId가 없으면 생성
    if (!localStorage.getItem('machineId')) {
        let machineId = Math.random().toString(36).substr(2, 8);
        localStorage.setItem('machineId', machineId);
    }
    //$("#machineId").text(localStorage.getItem('machineId'));
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

//#endregion

function getTitle(){
    var num = Math.floor((Math.random() * 5)) + 1;
    var titleNum = "/images/"+num+".png";
    document.getElementById("title").setAttribute("src",titleNum);
}