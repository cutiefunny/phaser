//페이지 시작 시 수행되는 함수
window.onload = function(){
    const urlParams = new URLSearchParams(window.location.search);
    const ref = urlParams.get('ref');
    if (ref) {
      document.querySelector('select').value = ref;
    }
};

function setRef(ref){
  location.href = baseUrl + "/seoulData?ref=" + ref;
}

function search(){
  let prompt = document.getElementById("search").value;
  let data = document.getElementById("allData").innerText;
  callFetchApi("POST", baseUrl + "/search", JSON.stringify({prompt:prompt,data:data}));
}