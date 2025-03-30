//페이지 시작 시 수행되는 함수
window.onload = function(){
    // machineId가 없으면 생성
    if (!localStorage.getItem('machineId')) {
        let machineId = Math.random().toString(36).substr(2, 8);
        localStorage.setItem('machineId', machineId);
    }
};

function getTitle(){
    var num = Math.floor((Math.random() * 5)) + 1;
    var titleNum = "/images/"+num+".png";
    document.getElementById("title").setAttribute("src",titleNum);
}