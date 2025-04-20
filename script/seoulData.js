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

function search(comp){
  comp.classList.add("loading");
  let prompt = document.getElementById("search").value;
  let data = document.getElementById("allData").innerText;
  callFetchApi("POST", baseUrl + "/search", JSON.stringify({prompt:prompt,data:data}));
}

function processAudio() {
    const audio = document.getElementById('audioInput');
    const file = audio.files[0];
    const reader = new FileReader();
    reader.onload = function(event) {
        const audioData = event.target.result;
        const base64Audio = btoa(String.fromCharCode.apply(null, new Uint8Array(audioData)));
        callFetchApi("POST", baseUrl + "/processAudio", JSON.stringify({audio:base64Audio}));
    };
    reader.readAsArrayBuffer(file);
}