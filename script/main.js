window.onload = function() {

};

function getTitle(){
    var num = Math.floor((Math.random() * 5)) + 1;
    var titleNum = "/images/"+num+".png";
    document.getElementById("title").setAttribute("src",titleNum);
}