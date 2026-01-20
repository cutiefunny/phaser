// PWA 제거용: 기존에 설치된 서비스 워커가 있다면 삭제합니다.
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(function(registrations) {
        for(let registration of registrations) {
            registration.unregister();
            console.log('Service Worker unregistered.');
        }
    });
}