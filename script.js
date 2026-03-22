var canvas = document.getElementById("chessCanvas");
var ctx = canvas.getContext("2d");

var whiteColor = "#b5f0cd";
var blackColor = "#59a473";
var coordinatesColor = "#000000";
var marginColor = "#f0e4d7";
var selectedSquareColor = "rgba(255, 215, 0, 0.45)";
var legalMoveColor = "rgba(20, 61, 42, 0.28)";
var captureMoveColor = "rgba(201, 47, 47, 0.35)";
var lastMoveColor = "rgba(52, 152, 219, 0.28)";

var squareSize = 45;
var boardSize = 8;
var marginSize = 20;
var fontSize = 12;
var font = fontSize + "px Arial";

canvas.width = boardSize * squareSize + marginSize;
canvas.height = boardSize * squareSize + marginSize;

var piezas = {
  p: "BlackPawn.png",
  r: "BlackRook.png",
  n: "BlackKnight.png",
  b: "BlackBishop.png",
  q: "BlackQueen.png",
  k: "BlackKing.png",
  P: "WhitePawn.png",
  R: "WhiteRook.png",
  N: "WhiteKnight.png",
  B: "WhiteBishop.png",
  Q: "WhiteQueen.png",
  K: "WhiteKing.png"
};

var initialFEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
var chess = new Chess(initialFEN);
var selectedPiece = null;
var legalMoves = [];
var moves = [];
var currentMoveIndex = 0;
var lastMove = null;
var pendingPromotion = null;

var fenInput = document.getElementById("fenInput");
var statusText = document.getElementById("statusText");
var moveListDiv = document.getElementById("move-list");
var previousMoveButton = document.getElementById("previous-move");
var nextMoveButton = document.getElementById("next-move");
var promotionModal = document.getElementById("promotionModal");
var promotionOptions = document.getElementById("promotionOptions");

var pieceImages = preloadPieceImages();

document.getElementById("resetBoard").addEventListener("click", resetBoard);
document.getElementById("applyFEN").addEventListener("click", loadFen);
document.getElementById("fileInput").addEventListener("change", loadPgn);
previousMoveButton.addEventListener("click", goToPreviousMove);
nextMoveButton.addEventListener("click", goToNextMove);
moveListDiv.addEventListener("click", onMoveListClick);
canvas.addEventListener("click", onCanvasClick);

drawPosition();

function preloadPieceImages() {
  var images = {};
  Object.keys(piezas).forEach(function(symbol) {
    var image = new Image();
    image.src = "img/" + piezas[symbol];
    images[symbol] = image;
  });
  return images;
}

function drawBoard() {
  ctx.fillStyle = marginColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (var row = 0; row < boardSize; row++) {
    for (var col = 0; col < boardSize; col++) {
      var color = (row + col) % 2 === 0 ? whiteColor : blackColor;
      ctx.fillStyle = color;
      ctx.fillRect(col * squareSize + marginSize, row * squareSize, squareSize, squareSize);
    }
  }

  ctx.fillStyle = coordinatesColor;
  ctx.font = font;
  ctx.textAlign = "center";

  for (var boardCol = 0; boardCol < boardSize; boardCol++) {
    ctx.fillText(
      String.fromCharCode(65 + boardCol),
      boardCol * squareSize + squareSize / 2 + marginSize,
      canvas.height - marginSize / 2 + fontSize / 2
    );
  }

  ctx.textAlign = "right";
  for (var boardRow = 0; boardRow < boardSize; boardRow++) {
    ctx.fillText(
      boardSize - boardRow,
      marginSize / 2,
      boardRow * squareSize + squareSize / 2 + fontSize / 2
    );
  }
}

function drawHighlights() {
  if (lastMove) {
    highlightSquare(lastMove.from, lastMoveColor);
    highlightSquare(lastMove.to, lastMoveColor);
  }

  if (selectedPiece) {
    highlightSquare(selectedPiece.square, selectedSquareColor);
  }

  legalMoves.forEach(function(move) {
    var highlightColor = move.captured ? captureMoveColor : legalMoveColor;
    highlightSquare(move.to, highlightColor);
  });
}

function highlightSquare(square, color) {
  var coordinates = squareToCoordinates(square);
  ctx.fillStyle = color;
  ctx.fillRect(
    coordinates.col * squareSize + marginSize,
    coordinates.row * squareSize,
    squareSize,
    squareSize
  );
}

function drawPiecesFromFen(fen) {
  var rows = fen.split(" ")[0].split("/");
  for (var row = 0; row < 8; row++) {
    var col = 0;
    for (var i = 0; i < rows[row].length; i++) {
      var char = rows[row][i];
      if (isNaN(char)) {
        drawPiece(row, col, char);
        col++;
      } else {
        col += parseInt(char, 10);
      }
    }
  }
}

function drawPiece(row, col, pieceSymbol) {
  var image = pieceImages[pieceSymbol];
  if (!image) {
    return;
  }

  var x = col * squareSize + marginSize;
  var y = row * squareSize;

  if (image.complete) {
    ctx.drawImage(image, x, y, squareSize, squareSize);
    return;
  }

  image.onload = function() {
    drawPosition();
  };
}

function drawPosition() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBoard();
  drawHighlights();
  drawPiecesFromFen(chess.fen());
  updateFenInput();
  updateStatus();
  updateMoveList();
  toggleNavigationButtons();
}

function onCanvasClick(event) {
  if (pendingPromotion) {
    return;
  }

  var x = event.clientX - canvas.getBoundingClientRect().left - marginSize;
  var y = event.clientY - canvas.getBoundingClientRect().top;
  var row = Math.floor(y / squareSize);
  var col = Math.floor(x / squareSize);

  if (row >= 0 && row < 8 && col >= 0 && col < 8) {
    handleSquareClick(row, col);
  }
}

function handleSquareClick(row, col) {
  var square = toAlgebraic(row, col);
  var piece = chess.get(square);

  if (selectedPiece && selectedPiece.square === square) {
    clearSelection();
    drawPosition();
    return;
  }

  if (selectedPiece) {
    var chosenMove = getLegalMoveTo(square);
    if (chosenMove) {
      if (needsPromotion(selectedPiece.square, square)) {
        openPromotionDialog(selectedPiece.square, square);
      } else {
        executeBoardMove({ from: selectedPiece.square, to: square });
      }
      return;
    }
  }

  if (piece && piece.color === chess.turn()) {
    selectedPiece = { square: square, piece: piece };
    legalMoves = chess.moves({ square: square, verbose: true });
  } else {
    clearSelection();
  }

  drawPosition();
}

function getLegalMoveTo(square) {
  for (var i = 0; i < legalMoves.length; i++) {
    if (legalMoves[i].to === square) {
      return legalMoves[i];
    }
  }
  return null;
}

function needsPromotion(fromSquare, toSquare) {
  var piece = chess.get(fromSquare);
  if (!piece || piece.type !== "p") {
    return false;
  }

  return (piece.color === "w" && toSquare[1] === "8") || (piece.color === "b" && toSquare[1] === "1");
}

function openPromotionDialog(fromSquare, toSquare) {
  pendingPromotion = { from: fromSquare, to: toSquare, color: chess.turn() };
  promotionOptions.innerHTML = "";

  ["q", "r", "b", "n"].forEach(function(pieceType) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "promotion-option";

    var image = document.createElement("img");
    image.src = "img/" + piezas[pendingPromotion.color === "w" ? pieceType.toUpperCase() : pieceType];
    image.alt = pieceType;
    button.appendChild(image);

    button.addEventListener("click", function() {
      executeBoardMove({
        from: pendingPromotion.from,
        to: pendingPromotion.to,
        promotion: pieceType
      });
      closePromotionDialog();
    });

    promotionOptions.appendChild(button);
  });

  promotionModal.classList.remove("hidden");
}

function closePromotionDialog() {
  pendingPromotion = null;
  promotionModal.classList.add("hidden");
}

function executeBoardMove(moveData) {
  var move = chess.move(moveData);
  if (!move) {
    return;
  }

  if (moves.length > 0 && currentMoveIndex < moves.length) {
    moves = moves.slice(0, currentMoveIndex);
  }

  moves.push(move);
  currentMoveIndex = moves.length;
  lastMove = { from: move.from, to: move.to };
  clearSelection();
  drawPosition();
}

function clearSelection() {
  selectedPiece = null;
  legalMoves = [];
}

function toAlgebraic(row, col) {
  return "abcdefgh"[col] + (8 - row);
}

function squareToCoordinates(square) {
  return {
    row: 8 - parseInt(square[1], 10),
    col: "abcdefgh".indexOf(square[0])
  };
}

function resetBoard() {
  chess.reset();
  moves = [];
  currentMoveIndex = 0;
  lastMove = null;
  clearSelection();
  closePromotionDialog();
  drawPosition();
}

function loadFen() {
  var fen = fenInput.value;
  var valid = chess.validate_fen(fen);
  if (!valid.valid) {
    alert("FEN invalido: " + valid.error);
    return;
  }

  chess.load(fen);
  moves = [];
  currentMoveIndex = 0;
  lastMove = null;
  clearSelection();
  closePromotionDialog();
  drawPosition();
}

function toggleNavigationButtons() {
  nextMoveButton.disabled = currentMoveIndex >= moves.length;
  previousMoveButton.disabled = currentMoveIndex <= 0;
}

function updateFenInput() {
  fenInput.value = chess.fen();
}

function updateStatus() {
  var sideToMove = chess.turn() === "w" ? "blancas" : "negras";
  var status = "Turno: " + sideToMove;

  if (chess.in_checkmate()) {
    status = "Jaque mate. Ganan las " + (chess.turn() === "w" ? "negras" : "blancas") + ".";
  } else if (chess.in_stalemate()) {
    status = "Tablas por ahogado.";
  } else if (chess.in_draw()) {
    status = "Tablas.";
  } else if (chess.in_check()) {
    status += " en jaque.";
  }

  statusText.textContent = status;
}

async function loadPgn() {
  var fileInput = document.getElementById("fileInput");
  var file = fileInput.files[0];
  if (!file) {
    return;
  }

  try {
    var pgn = await readFileAsText(file);
    var result = chess.load_pgn(pgn);
    if (!result) {
      alert("Archivo PGN invalido");
      return;
    }

    moves = chess.history({ verbose: true });
    chess.reset();
    currentMoveIndex = 0;
    lastMove = null;
    clearSelection();
    closePromotionDialog();
    drawPosition();
  } catch (error) {
    alert("Error leyendo archivo PGN: " + error);
  }
}

function readFileAsText(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function(event) {
      resolve(event.target.result);
    };
    reader.onerror = function() {
      reject(new Error("No se pudo leer el archivo"));
    };
    reader.readAsText(file);
  });
}

function updateMoveList() {
  var html = "<ol>";

  for (var i = 0; i < moves.length; i += 2) {
    html += "<li>";

    if (moves[i]) {
      html += buildMoveLink(i);
    }

    if (moves[i + 1]) {
      html += buildMoveLink(i + 1);
    }

    html += "</li>";
  }

  html += "</ol>";
  moveListDiv.innerHTML = html;
}

function buildMoveLink(index) {
  var isCurrent = index === currentMoveIndex - 1;
  return (
    '<a href="#" data-move-index="' +
    index +
    '"' +
    (isCurrent ? ' class="current-move"' : "") +
    ">" +
    moves[index].san +
    "</a> "
  );
}

function onMoveListClick(event) {
  var moveLink = event.target.closest("[data-move-index]");
  if (!moveLink) {
    return;
  }

  event.preventDefault();
  goToMove(parseInt(moveLink.getAttribute("data-move-index"), 10));
}

function goToPreviousMove() {
  if (currentMoveIndex <= 0) {
    return;
  }

  chess.undo();
  currentMoveIndex--;
  clearSelection();
  closePromotionDialog();
  lastMove = currentMoveIndex > 0
    ? { from: moves[currentMoveIndex - 1].from, to: moves[currentMoveIndex - 1].to }
    : null;
  drawPosition();
}

function goToNextMove() {
  if (currentMoveIndex >= moves.length) {
    return;
  }

  var move = chess.move(moves[currentMoveIndex]);
  currentMoveIndex++;
  clearSelection();
  lastMove = move ? { from: move.from, to: move.to } : null;
  drawPosition();
}

function goToMove(index) {
  chess.reset();

  for (var i = 0; i <= index; i++) {
    chess.move(moves[i]);
  }

  currentMoveIndex = index + 1;
  clearSelection();
  closePromotionDialog();
  lastMove = moves[index] ? { from: moves[index].from, to: moves[index].to } : null;
  drawPosition();
}
