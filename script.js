// Get a reference to the canvas element
var canvas = document.getElementById("chessCanvas");
var ctx = canvas.getContext("2d");

// Define the colors for the squares and coordinates
var whiteColor = "#b5f0cd";
var blackColor = "#59a473";
var coordinatesColor = "#000000"; // Black color for coordinates
var marginColor = "#f0e4d7"; // Light beige for margin background

// Define the size of the squares and the board
var squareSize = 45;
var boardSize = 8;

// Constants for margin size and font settings
var marginSize = 20;
var fontSize = 12;
var font = fontSize + "px Arial";

// Adjust the canvas size to include the margin
canvas.width = boardSize * squareSize + marginSize;
canvas.height = boardSize * squareSize + marginSize;

const piezas = {
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
  K: "WhiteKing.png",
};

document.getElementById('resetBoard').addEventListener('click', resetBoard);
document.getElementById('applyFEN').addEventListener('click', loadFen);
document.getElementById('fileInput').addEventListener('change', loadPgn);

function drawBoard() {
  // Fill the entire margin area with the specified color
  ctx.fillStyle = marginColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height); // Fill entire margin area
  // Draw the squares by iterating through the rows and columns
  for (var row = 0; row < boardSize; row++) {
    for (var col = 0; col < boardSize; col++) {
      var color = (row + col) % 2 === 0 ? whiteColor : blackColor;
      ctx.fillStyle = color;
      ctx.fillRect( // Note the addition of the marginSize to the x-coordinate
        col * squareSize + marginSize,
        row * squareSize,
        squareSize,
        squareSize
      );
    }
  }
  ctx.fillStyle = coordinatesColor; // Draw the letters A to H at the bottom
  ctx.font = font;
  ctx.textAlign = "center";
  for (var col = 0; col < boardSize; col++) {
    var letter = String.fromCharCode(65 + col);
    ctx.fillText(
      letter,
      col * squareSize + squareSize / 2 + marginSize,
      canvas.height - marginSize / 2 + fontSize / 2
    );
  }
  ctx.textAlign = "right"; // Draw the numbers 1 to 8 on the left side
  for (var row = 0; row < boardSize; row++) {
    var number = boardSize - row;
    ctx.fillText(
      number,
      marginSize / 2,
      row * squareSize + squareSize / 2 + fontSize / 2
    );
  }
}

function drawFenPosition(fen) {
  updateFenInput(); // Update the FEN input box after the move
  ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear the canvas
  drawBoard();
  var rows = fen.split(' ')[0].split('/'); // Draw the pieces based on the FEN
  for (var row = 0; row < 8; row++) {
    var col = 0;
    for (var char of rows[7-row]) {
      if (isNaN(char)) { // If it's a letter (piece symbol)
        var pieceSymbol = char;
        var imageName = piezas[pieceSymbol]; // Get the image name from the piezas array
        var image = new Image();
        image.src = 'img/' + imageName; // Adjust the path
        var x = col * squareSize + marginSize;
        var y = (7 - row) * squareSize;
        image.onload = (function(x, y, image) {
          return function() {
            ctx.drawImage(image, x, y, squareSize, squareSize);
          };
        })(x, y, image);
        col++;
      } else { // If it's a number (empty squares)
        col += parseInt(char);
      }
    }
  }
}


// Initial FEN for the standard chess starting position
var initialFEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
var chess = new Chess(initialFEN);
drawFenPosition(initialFEN); // Call the drawFenPosition function with the initial FEN
var canvas = document.getElementById('chessCanvas'); // Reference to the canvas element
var selectedPiece = null; // Variable to hold the currently selected piece
var moves = []; // Array of moves
var currentMoveIndex = 0;

// Add a click event listener to the canvas
canvas.addEventListener('click', function(event) {
  // Get the mouse click position
  var x = event.clientX - canvas.getBoundingClientRect().left - marginSize;
  var y = event.clientY - canvas.getBoundingClientRect().top;
  // Calculate the row and column corresponding to the click
  var row = Math.floor(y / squareSize);
  var col = Math.floor(x / squareSize);
  // Check if the click is within the board bounds
  if (row >= 0 && row < 8 && col >= 0 && col < 8) {
    // Handle the click on the square (row, col)
    handleSquareClick(row, col);
  }
});

function handleSquareClick(row, col) { // Function to handle the click on a specific square
  var square = toAlgebraic(row, col);
  var piece = chess.get(square); // Get the piece at the clicked square using chess.js
  if (selectedPiece) { // If there's already a selected piece, try to move it
    movePiece(selectedPiece.square, square); // selectedPiece.square should be the algebraic notation of the selected piece's square
    selectedPiece = null; // Deselect the piece
  } else if (piece) { // If there's a piece at the clicked square, select it
    selectedPiece = { square: square, piece: piece };
  }
}
  
function movePiece(fromSquare, toSquare) { // Perform the move using chess.js
  var move = chess.move({
    from: fromSquare,
    to: toSquare
  });
  if (move) { // Redraw only the changed squares
    redrawSquare(fromSquare); // Redraw the source square (empty)
    redrawSquare(toSquare); // Redraw the destination square (with the moved piece)
    updateFenInput(); // Update the FEN input box after the move
  } else { // The move is illegal; you can show an error message or ignore it
    console.log("Illegal move!");
  }
}

function redrawSquare(square) { // Convert the algebraic notation to row and col
  var row = 8 - parseInt(square[1]);
  var col = 'abcdefgh'.indexOf(square[0]);
  drawSquare(row, col); // Draw the square (empty or with the piece, depending on the new position)
  var piece = chess.get(square);
  if (piece) {
    drawPiece(row, col, piece);
  }
}

function toAlgebraic(row, col) {
  var letters = 'abcdefgh';
  var letter = letters[col];
  var number = 8 - row; // La fila 0 corresponde al número 8, la fila 1 al número 7, etc.
  return letter + number;
}

function drawSquare(row, col) {
  var x = col * squareSize + marginSize;
  var y = row * squareSize;
  var color = (row + col) % 2 === 0 ? whiteColor : blackColor; // Ajusta los colores según tus preferencias
  ctx.fillStyle = color;
  ctx.fillRect(x, y, squareSize, squareSize);
}

function drawPiece(row, col, piece) {
  var x = col * squareSize + marginSize;
  var y = row * squareSize;
  var imageName = pieceTypeToImageName(piece.type, piece.color); // Convierte el tipo y el color de la pieza en el nombre de la imagen
  var image = new Image();
  image.src = 'img/' + imageName; // Ajusta la ruta según la ubicación de tus imágenes
  image.onload = function () {
    ctx.drawImage(image, x, y, squareSize, squareSize);
  };
}

function pieceTypeToImageName(type, color) { // Convert the type and color into a symbol used in the FEN
  var symbol = type; // Assuming type is one of 'p', 'r', 'n', 'b', 'q', 'k'
  if (color === 'w') {
    symbol = symbol.toUpperCase(); // Convert to uppercase for white pieces
  }
  var imageName = piezas[symbol]; // Look up the image name in the piezas array
  return imageName;
}

function resetBoard() {
  chess.reset(); // Reset the internal game state to the starting position
  drawFenPosition(chess.fen()); // Redraw the board with the starting position
  currentMoveIndex=0;
  updateMoveList();
}

function loadFen() {
  var fenInput = document.getElementById('fenInput');
  var fen = fenInput.value;
  var valid = chess.validate_fen(fen); // Validate the FEN using chess.js
  if (valid.valid) {
    chess.load(fen); // Load the FEN into the internal game state
    moves = []; // Reset the moves
    currentMoveIndex = 0; // Reset the current move index
    drawFenPosition(fen); // Redraw the board with the new position
    updateMoveList();
    toggleNavigationButtons(); // Function to enable/disable navigation buttons
  } else {
    alert('Invalid FEN: ' + valid.error); // Show an error message if the FEN is invalid
  }
}

// Function to toggle navigation buttons based on available moves
function toggleNavigationButtons() {
  document.getElementById('next-move').disabled = moves.length === 0;
  document.getElementById('previous-move').disabled = moves.length === 0;
}

function updateFenInput() {
  var fen = chess.fen(); // Get the current FEN from chess.js
  document.getElementById('fenInput').value = fen; // Update the input box with the FEN
}

async function loadPgn() {
  var fileInput = document.getElementById('fileInput');
  var file = fileInput.files[0];
  if (!file) return; // Simply return if no file is selected
  try {
    var pgn = await readFileAsText(file);
    var result = chess.load_pgn(pgn);
    if (result) {
      moves = chess.history({ verbose: true }); // Save the moves
      chess.reset(); // Reset to the initial position
      currentMoveIndex = 0; // Set to the end of the game
      drawFenPosition(chess.fen());
      updateFenInput(); // Update the FEN input box
      updateMoveList();
      toggleNavigationButtons(); // Update the navigation buttons based on the new moves
    } else {
      alert('Invalid PGN file');
    }
  } catch (error) {
    alert('Error reading PGN file: ' + error);
  }
}
 
function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      var reader = new FileReader();
      reader.onload = function(e) {
        resolve(e.target.result);
      };
      reader.onerror = function(e) {
        reject(new Error('Failed to read file'));
      };
      reader.readAsText(file);
    });
  }

  function updateMoveList() {
    var moveListDiv = document.getElementById('move-list');
    var html = '<ol>';
    for (var i = 0; i < moves.length; i += 2) {
      html += '<li>';
      if (moves[i]) {
        html += '<a href="#" onclick="goToMove(' + i + ')"' + (i === currentMoveIndex ? ' class="current-move"' : '') + '>' + moves[i].san + '</a> ';
      }
      if (moves[i + 1]) {
        html += '<a href="#" onclick="goToMove(' + (i + 1) + ')"' + (i + 1 === currentMoveIndex ? ' class="current-move"' : '') + '>' + moves[i + 1].san + '</a>';
      }
      html += '</li>';
    }
    html += '</ol>';
    moveListDiv.innerHTML = html;
  }
    
  document.getElementById('previous-move').addEventListener('click', function() {
    if (currentMoveIndex > 0) {
      currentMoveIndex--;
      var move = moves[currentMoveIndex];
      chess.undo(); // Revert the last move
      redrawSquare(move.from);
      redrawSquare(move.to);
      updateMoveList();
    }
  });
  
  document.getElementById('next-move').addEventListener('click', function() {
    if (currentMoveIndex < moves.length) {
      var move = moves[currentMoveIndex];
      movePiece(move.from, move.to);
      currentMoveIndex++;
      updateMoveList();
    }
  });
  
  function goToMove(index) {
    chess.reset();
    for (var i = 0; i < index; i++) {
      chess.move(moves[i]);
    }
    currentMoveIndex = index;
    drawFenPosition(chess.fen());
    updateMoveList();
  }
 