function leftBtn() {
    document.getElementById("left").style.display = "block";
    document.getElementById("chessboard").style.display = "none";
    document.getElementById("right").style.display = "none";
  }
  
  function centerBtn() {
    document.getElementById("left").style.display = "none";
    document.getElementById("chessboard").style.display = "block";
    document.getElementById("right").style.display = "none";
  }

  function rightBtn() {
    document.getElementById("left").style.display = "none";
    document.getElementById("chessboard").style.display = "none";
    document.getElementById("right").style.display = "block";
  }