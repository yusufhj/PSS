$(document).ready(function() {
    $('#parkingImage').attr('src', '/static_frame');
    initializeCanvas(); 
    attachEventListeners();  
    updateButtonStates();  
    draw();  
});
document.getElementById("captureFrameButton").addEventListener("click", function() {
    console.log("Capture Frame button clicked");
    fetch('/capture_frame', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    }).then(response => {
        console.log("Response received");
        return response.json();
    }).then(data => {
        console.log("Data processed");
        if (data.message === "Frame captured successfully!") {
            console.log(data.message);
            // Append a timestamp to force reload the image
            document.getElementById("parkingImage").src = "../static/captured_frame.jpg?" + new Date().getTime();
        } else {
            console.error(data.message);
        }
    }).catch(error => {
        console.error('Error:', error);
    });
});


let canvas, ctx, img;  
let polygons = [], currentPolygon = [], labels = []; 
let selectedPolygon = null, selectedIndex = -1, selectedCornerIndex = -1; 
let zoomLevel = 1, zoomPoint = { x: 0, y: 0 };  
let history = [], future = []; 
let snapMode = false, currentSnapPoint = null;  
let dragStartX = 0, dragStartY = 0; 
let newlyAddedPolygons = []; 
let mousePos = { x: 0, y: 0 };  
let isDragging = false;  
let throttleTimer = null;
let currentMode = null;
let entrance = null;
let destination = null;
let resizing = false, moving = false;
let selectedRect = null;

function initializeCanvas() {
    img = document.getElementById('parkingImage');
    canvas = document.getElementById('pickerCanvas');
    if (!canvas || !img) {
        console.error('Canvas or image element not found');
        return;
    }
    ctx = canvas.getContext('2d');

    adjustCanvasSize();
    loadImage();
}
function adjustCanvasSize() {
    var aspectRatio = img.naturalWidth / img.naturalHeight;
    var canvasHeight = window.innerHeight;
    var canvasWidth = window.innerWidth;
    var canvasAspectRatio = canvasWidth / canvasHeight;

    if (canvasAspectRatio > aspectRatio) {
        canvasWidth = canvasHeight * aspectRatio;
    } else {
        canvasHeight = canvasWidth / aspectRatio;
    }

    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
}
function loadImage() {
    if (!img.complete) { 
        img.onload = () => { 
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight);
            loadAnnotations();
        };
    } else {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight);
        loadAnnotations();
    }
}
function attachEventListeners() {
    canvas.addEventListener('mousedown', onMouseDown);  
    canvas.addEventListener('mousemove', onMouseMove);  
    canvas.addEventListener('mouseup', onMouseUp); 
    canvas.addEventListener('wheel', onWheel, { passive: false }); 

    document.getElementById('zoomInButton').addEventListener('click', () => adjustZoom(0.1));  
    document.getElementById('zoomOutButton').addEventListener('click', () => adjustZoom(-0.1));  

    document.getElementById('undoButton').addEventListener('click', undo);  
    document.getElementById('redoButton').addEventListener('click', redo);  
    document.getElementById('clearAllButton').addEventListener('click', clearAll);  
    document.getElementById('save-btn').addEventListener('click', saveChanges);  
    document.getElementById('cancel-btn').addEventListener('click', cancel);  
    document.getElementById('delete-btn').addEventListener('click', deleteSelectedPolygon); 
    document.getElementById('change-label-btn').addEventListener('click', changeLabel);  

    document.getElementById('add-btn').addEventListener('click', () => setMode('add'));
    document.getElementById('edit-btn').addEventListener('click', () => setMode('edit'));
    document.getElementById('entrance-btn').addEventListener('click', () => setMode('entrance'));
    document.getElementById('destination-btn').addEventListener('click', () => setMode('destination'));
    
    

}
function calculateBoundingBox(polygon) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    polygon.forEach(point => {
        if (point.x < minX) minX = point.x;
        if (point.x > maxX) maxX = point.x;
        if (point.y < minY) minY = point.y;
        if (point.y > maxY) maxY = point.y;
    });
    return { minX, minY, maxX, maxY };
}

// AJAX Functions
function saveChanges() {
    if (confirm("Are you sure you want to save the changes?")) {
        if (currentPolygon.length === 4) {
            finishPolygon();
        }
        
        const data = {
            polygons: polygons.map((polygon, index) => ({
                points: polygon.map(point => [Math.round(point.x), Math.round(point.y)]),
                label: labels[index]
            })),
            entrance: {
                startX: entrance ? Math.round(entrance.startX) : null,
                startY: entrance ? Math.round(entrance.startY) : null,
                endX: entrance ? Math.round(entrance.endX) : null,
                endY: entrance ? Math.round(entrance.endY) : null
            },
            destination: {
                startX: destination ? Math.round(destination.startX) : null,
                startY: destination ? Math.round(destination.startY) : null,
                endX: destination ? Math.round(destination.endX) : null,
                endY: destination ? Math.round(destination.endY) : null
            }
        };

        $.ajax({
            url: '/save_annotations',  
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(data),
            success: () => {
                alert("Changes saved successfully.");
                clearHistory(); 
                setMode(null);
                draw();
            },
            error: (xhr, status, error) => {
                console.error("Failed to save annotations:", error);
                alert("Failed to save changes. Please try again.");
            }
        });
    }
}
function loadAnnotations() {
    $.ajax({
        url: '/load_annotations',
        type: 'GET',
        success: (data) => {
            if (data) {
                polygons = data.polygons.map(poly => poly.points.map(point => ({ x: point[0], y: point[1] })));
                labels = data.polygons.map(poly => poly.label);

                entrance = (data.entrance && data.entrance.startX > 0 && data.entrance.startY > 0 && data.entrance.endX > 0 && data.entrance.endY > 0) 
                    ? data.entrance 
                    : { startX: 10, startY: 60, endX: 110, endY: 120 };

                destination = (data.destination && data.destination.startX > 0 && data.destination.startY > 0 && data.destination.endX > 0 && data.destination.endY > 0) 
                    ? data.destination 
                    : { startX: canvas.width - 110, startY: 60, endX: canvas.width - 10, endY: 120 };
                
                draw(); 
            }
        },
        error: (xhr, status, error) => console.error("Failed to load annotations:", error)
    });
}
function setMode(newMode) {
    console.log(`Mode changing from ${currentMode} to ${newMode}`);
    if (currentMode === newMode) return; 
    
    currentPolygon = [];  
    canvas.style.cursor = 'default';

    currentMode = newMode;  

    switch (currentMode) {
        case 'add':
            pushToHistory();
            document.getElementById('snap-toggle').style.display = 'block';
            document.getElementById('snap-toggle').textContent = 'Snap Mode OFF';
            canvas.style.cursor = 'crosshair'; 
            break;
        case 'edit':
            pushToHistory(); 
            document.getElementById('snap-toggle').style.display = 'none';
            break;
        case 'entrance':
            drawEntrance();
            document.getElementById('snap-toggle').style.display = 'none';
            break;
        case 'destination':
            drawDestination();
            document.getElementById('snap-toggle').style.display = 'none';
            break;
        default:
            currentPolygon = []; 
            canvas.style.cursor = 'default';
            snapMode = false
            selectedPolygon = null;
            selectedIndex = -1; 
            selectedCornerIndex = -1;
            draw();
            break;
    }

    updateButtonStates(); 
}

// Utility Functions
function getMousePos(canvas, evt) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;    
    const scaleY = canvas.height / rect.height; 

    return {
        x: ((evt.clientX - rect.left) * scaleX - zoomPoint.x) / zoomLevel,
        y: ((evt.clientY - rect.top) * scaleY - zoomPoint.y) / zoomLevel
    };
}
function getPolygonCentroid(polygon) {
    let x = 0, y = 0;
    polygon.forEach(point => { x += point.x; y += point.y; });
    return { x: x / polygon.length, y: y / polygon.length };
}

// Event Listeners and Handlers
function onMouseDown(e) {
    let mousePos = getMousePos(canvas, e); 
    if (currentMode === 'entrance' || currentMode === 'destination') {
        let rectangle = currentMode === 'entrance' ? entrance : destination;
        selectedCornerIndex = findSelectedCornerRectangle(mousePos, rectangle);
        
        if (selectedCornerIndex !== -1) {
            isDragging = true;
            resizing = true;
        } else if (pointInRectangle(mousePos, rectangle)) {
            isDragging = true;
            moving = true;
            dragStartX = mousePos.x;
            dragStartY = mousePos.y;
            canvas.style.cursor = 'move';
        }
    } else if (currentMode === 'add') {
        if (snapMode && currentSnapPoint) {
            addPointToCurrentPolygon(currentSnapPoint[0], currentSnapPoint[1]); 
            currentSnapPoint = null; 
        } else {
            addPointToCurrentPolygon(mousePos.x, mousePos.y); 
        }
        if (currentPolygon.length === 4) {
            finishPolygon();
            pushToHistory();
        }
        draw();
    } else if (currentMode === 'edit') {
        selectedCornerIndex = findSelectedCorner(mousePos);  
        if (selectedCornerIndex !== -1) {
            isDragging = true; 
            canvas.style.cursor = 'move';  
            pushToHistory(); 
        } else if (isPointInsidePolygon(mousePos, selectedPolygon)) {
            isDragging = true;
            dragStartX = mousePos.x;
            dragStartY = mousePos.y;
            canvas.style.cursor = 'move';
            pushToHistory();
        } else {
            selectPolygon(mousePos);
        }
    } else {
        isDragging = false;  
    }
}
function onMouseMove(e) {
    mousePos = getMousePos(canvas, e); 
    if (snapMode) requestSnapPoint(mousePos);  

    if (isDragging) {
        let deltaX = mousePos.x - dragStartX;
        let deltaY = mousePos.y - dragStartY;

        if (currentMode === 'entrance' || currentMode === 'destination') {
            let rectangle = currentMode === 'entrance' ? entrance : destination;
            if (resizing) {
                switch(selectedCornerIndex) {
                    case 0: rectangle.startX = mousePos.x; rectangle.startY = mousePos.y; break;
                    case 1: rectangle.endX = mousePos.x; rectangle.startY = mousePos.y; break;
                    case 2: rectangle.endX = mousePos.x; rectangle.endY = mousePos.y; break;
                    case 3: rectangle.startX = mousePos.x; rectangle.endY = mousePos.y; break;
                }
            } else if (moving) {
                rectangle.startX += deltaX;
                rectangle.endX += deltaX;
                rectangle.startY += deltaY;
                rectangle.endY += deltaY;
                dragStartX = mousePos.x;
                dragStartY = mousePos.y;
            }
        }
        if (selectedPolygon && selectedCornerIndex !== -1) {
            selectedPolygon[selectedCornerIndex] = mousePos;  
        } else if (selectedPolygon && selectedCornerIndex === -1) {
            selectedPolygon.forEach(point => {
                point.x += deltaX;
                point.y += deltaY;
            });
            dragStartX = mousePos.x;
            dragStartY = mousePos.y;
        } 
        draw();  
    } else if (currentMode == 'add' && currentPolygon.length > 0) {
        draw();  
    }
}
function onMouseUp(e) {
    if (isDragging) {
        if (currentMode === 'edit') {
            if (selectedCornerIndex !== -1) {
                selectedPolygon[selectedCornerIndex] = getMousePos(canvas, e);  
                draw(); 
                pushToHistory();  
                selectedCornerIndex = -1; 
            } else if (selectedPolygon) {
                selectedPolygon = null;
                selectedIndex = -1;
                pushToHistory();
            }
            isDragging = false; 
            canvas.style.cursor = 'default';
            draw();  

        } else if (currentMode === 'entrance' || currentMode === 'destination') {
            let rectangle = currentMode === 'entrance' ? entrance : destination;
            if (selectedCornerIndex !== -1) {
                let mousePos = getMousePos(canvas, e);
                switch (selectedCornerIndex) {
                    case 0: rectangle.startX = mousePos.x; rectangle.startY = mousePos.y; break;
                    case 1: rectangle.endX = mousePos.x; rectangle.startY = mousePos.y; break;
                    case 2: rectangle.endX = mousePos.x; rectangle.endY = mousePos.y; break;
                    case 3: rectangle.startX = mousePos.x; rectangle.endY = mousePos.y; break;
                }
            }
            draw(); 
            selectedCornerIndex = -1;
            resizing = false;
            moving = false;
            isDragging = false;
            canvas.style.cursor = 'default';
        }
    }
}
function onWheel(e) {
    e.preventDefault();
    if (zoomLevel > 1) {  
        let deltaX = e.deltaX * 2; 
        let deltaY = e.deltaY * 2;

        zoomPoint.x -= deltaX;
        zoomPoint.y -= deltaY;
        constrainZoom(); 
    }
    draw(); 
}

// Zoom Functions
function adjustZoom(change, center = { x: canvas.width / 2, y: canvas.height / 2 }) {
    var newZoomLevel = Math.max(1, Math.min(5, zoomLevel + change));
    if (newZoomLevel !== zoomLevel) {
        var oldZoom = zoomLevel;
        zoomLevel = newZoomLevel;
        adjustZoomPoint(center, oldZoom);
        draw();
    }
}
function adjustZoomPoint(center, oldZoom) {
    var factor = zoomLevel / oldZoom;
    zoomPoint.x = factor * (zoomPoint.x - center.x) + center.x;
    zoomPoint.y = factor * (zoomPoint.y - center.y) + center.y;
    constrainZoom();
}
function constrainZoom() {
    const overWidth = Math.max(0, img.naturalWidth * zoomLevel - canvas.width);
    const overHeight = Math.max(0, img.naturalHeight * zoomLevel - canvas.height);

    zoomPoint.x = Math.min(0, Math.max(-overWidth, zoomPoint.x));
    zoomPoint.y = Math.min(0, Math.max(-overHeight, zoomPoint.y));
}
function clampViewToImageBounds() {
    const minX = (canvas.width - img.width * zoomLevel) / zoomLevel;
    const minY = (canvas.height - img.height * zoomLevel) / zoomLevel;
    zoomPoint.x = Math.min(0, Math.max(minX, zoomPoint.x));
    zoomPoint.y = Math.min(0, Math.max(minY, zoomPoint.y));
}

// Drawing Functions
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);  
    ctx.save();  
    ctx.translate(zoomPoint.x, zoomPoint.y); 
    ctx.scale(zoomLevel, zoomLevel);  
    ctx.drawImage(img, 0, 0);  

    polygons.forEach((polygon, index) => {
        drawPolygon(polygon, 'rgba(0, 0, 255, 0.2)'); 
        if (labels[index]) drawLabel(polygon, labels[index]); 
    });
    if (currentPolygon.length > 0) drawTemporaryLines(mousePos); 
    if (selectedPolygon) drawPointers(selectedPolygon);
    if (currentSnapPoint && snapMode) drawSnapIndicator(currentSnapPoint);  

    if (currentMode == 'entrance') drawEntrance();
    if (currentMode == 'destination') drawDestination();
    ctx.restore();  
}
function drawPolygon(polygon) {
    ctx.beginPath(); 
    polygon.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);  
        else ctx.lineTo(point.x, point.y);  
    });
    ctx.closePath();  
    ctx.fillStyle = 'rgba(0, 0, 255, 0.2)';  
    ctx.fill(); 
    ctx.strokeStyle = 'blue';  
    ctx.stroke();  
}
function drawLabel(polygon, label) {
    let centroid = getPolygonCentroid(polygon);
    ctx.font = "14px Arial";
    ctx.fillStyle = "yellow";
    ctx.fillText(label, centroid.x, centroid.y);
}
function drawPointers(shape) {
    let points = [];

    if (shape.startX !== undefined) {
        points = [
            { x: shape.startX, y: shape.startY },
            { x: shape.endX, y: shape.startY },
            { x: shape.endX, y: shape.endY },
            { x: shape.startX, y: shape.endY }
        ];
    } else if (Array.isArray(shape)) {
        points = shape;
    }

    points.forEach(point => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 5 / zoomLevel, 0, Math.PI * 2);
        ctx.fillStyle = 'red';
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.stroke();
    });
}
function drawTemporaryLines(mousePos) {
    if (currentPolygon.length > 0) {
        ctx.beginPath();
        ctx.moveTo(currentPolygon[0].x, currentPolygon[0].y);
        currentPolygon.forEach((point, index) => {
            if (index > 0) ctx.lineTo(point.x, point.y);
        });

        ctx.lineTo(mousePos.x, mousePos.y);

        if (currentPolygon.length === 3) {
            ctx.moveTo(currentPolygon[0].x, currentPolygon[0].y); 
            ctx.lineTo(mousePos.x, mousePos.y); 

            ctx.moveTo(currentPolygon[2].x, currentPolygon[2].y);
            ctx.lineTo(mousePos.x, mousePos.y); 
        }

        ctx.strokeStyle = 'red';
        ctx.stroke();

        currentPolygon.forEach(point => drawPoint(point));
        drawPoint(mousePos);  
    }
}
function drawPoint(point) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 5 / zoomLevel, 0, Math.PI * 2);
    ctx.fillStyle = 'yellow';
    ctx.fill();
    ctx.strokeStyle = 'black';
    ctx.stroke();
}
function drawSnapIndicator(point) {
    if (!point) return;

    const adjustedX = (point[0] * zoomLevel) + zoomPoint.x;
    const adjustedY = (point[1] * zoomLevel) + zoomPoint.y;

    ctx.save(); 
    ctx.beginPath();
    ctx.arc(adjustedX, adjustedY, 5 / zoomLevel, 0, 2 * Math.PI, true);

    ctx.fillStyle = 'lime';
    ctx.fill();

    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1 / zoomLevel; 
    ctx.stroke();
    ctx.restore(); 
}

// Polygon Management Functions
function deleteSelectedPolygon() {
    if (selectedPolygon !== null) {
        const index = polygons.indexOf(selectedPolygon);
        if (index > -1) {
            polygons.splice(index, 1);
            labels.splice(index, 1);
            selectedPolygon = null;
            selectedIndex = -1;
            draw();
            pushToHistory();
        }
    }
    updateButtonStates(); 
}
function selectPolygon(mousePos) {
    let found = false;
    polygons.forEach((polygon, index) => {
        if (isPointInsidePolygon(mousePos, polygon)) {
            selectedPolygon = polygon;
            selectedIndex = index;
            found = true;
        }
    });
    if (!found) {
        selectedPolygon = null;
        selectedIndex = -1;  
    }
    updateButtonStates();
    draw(); 
}
function findSelectedCorner(pos) {
    if (!selectedPolygon) return -1;
    const threshold = 10 / zoomLevel; 
    return selectedPolygon.findIndex(point =>
        Math.sqrt(Math.pow(point.x - pos.x, 2) + Math.pow(point.y - pos.y, 2)) < threshold);
}
function isPointInsidePolygon(point, polygon) {
    if (!polygon) return false;
    let x = point.x, y = point.y;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        let xi = polygon[i].x, yi = polygon[i].y;
        let xj = polygon[j].x, yj = polygon[j].y;
        let intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}
function finishPolygon() {
    if (currentPolygon.length >= 4) { 
        polygons.push(currentPolygon.slice());
        labels.push(prompt("Enter label for this polygon:", "New Polygon") || "");
        newlyAddedPolygons.push(polygons.length - 1);
        currentPolygon = []; 
    }
}
function addPointToCurrentPolygon(x, y) {
    if (currentMode === 'add') {
        currentPolygon.push({ x: x, y: y });
        draw();
        pushToHistory();
        if (currentPolygon.length === 4) finishPolygon();
    }
}

// Management Functions
function pointInRectangle(point, rect) {
    return point.x >= rect.startX && point.x <= rect.endX &&
           point.y >= rect.startY && point.y <= rect.endY;
}
function drawRectangle(rect, fillStyle) {
    ctx.beginPath();
    ctx.rect(rect.startX, rect.startY, rect.endX - rect.startX, rect.endY - rect.startY);
    ctx.fillStyle = fillStyle;
    ctx.fill();
}

// State Management Functions
function pushToHistory() {
    const currentState = {
        polygons: JSON.parse(JSON.stringify(polygons)),
        labels: JSON.parse(JSON.stringify(labels)),
        currentPolygon: JSON.parse(JSON.stringify(currentPolygon)),
        justFinished: currentPolygon.length === 0 && polygons.length > 0
    };
    const lastState = history.length > 0 ? history[history.length - 1] : null;
    if (!lastState || JSON.stringify(lastState) !== JSON.stringify(currentState)) {
        history.push(currentState);
        future = [];
        updateUndoRedoButtons();
    }
}
function restoreState(state) {
    polygons = state.polygons.map(polygon => polygon.map(point => ({...point})));
    labels = [...state.labels];
    currentPolygon = [...state.currentPolygon];
    draw();
}
function undo() {
    if (history.length > 1) {
        future.push(history.pop());
        const prevState = history[history.length - 1];
        restoreState(prevState);
        updateSelectionOnUndoRedo(prevState); 
        if (prevState.currentPolygon.length === 4) {
            undo();
        }
    } else {
        console.warn("No more states to undo.");
    }
    updateUndoRedoButtons();
}
function redo() {
    if (future.length > 0) {
        const nextState = future.pop();
        history.push(nextState);
        restoreState(nextState);
        updateSelectionOnUndoRedo(nextState);
        if (currentPolygon.length === 4) {
            finishPolygon();
            draw(); 
        }
        if (future.length > 0 && nextState.currentPolygon.length === 4) {
            redo();
        }
    }
    updateUndoRedoButtons();
}
function cancel() {
    if (confirm("Are you sure you want to cancel the current operation?")) {

        if (currentMode === 'add') {
            polygons = polygons.filter((_, index) => !newlyAddedPolygons.includes(index));
            labels = labels.filter((_, index) => !newlyAddedPolygons.includes(index));
            newlyAddedPolygons = [];
            currentPolygon = [];
        }

        if ( history.length > 0) {
            const initialState = history[0];
            restoreState(initialState);
            history = [initialState]; 
            future = [];
        } 
        setMode(null); 
        updateButtonStates();
        draw();
    }
}
function changeLabel() {
    if (selectedPolygon && selectedIndex !== -1) {
        const currentLabel = labels[selectedIndex];
        const newLabel = prompt("Change label:", currentLabel);
        if (newLabel !== null && newLabel !== currentLabel) {
            labels[selectedIndex] = newLabel;
            draw();
            pushToHistory();
        }
    }
    updateButtonStates();
}
function clearAll() {
    if (confirm("Are you sure you want to clear all annotations?")) {
        pushToHistory();

        if (currentMode === 'add') {
            polygons = polygons.filter((_, index) => !newlyAddedPolygons.includes(index));
            labels = labels.filter((_, index) => !newlyAddedPolygons.includes(index));
            newlyAddedPolygons = []; 
            currentPolygon = []; 
        } else if (currentMode == 'edit') {
            polygons = [];
            labels = [];
            selectedPolygon = null;
            selectedIndex = -1;
            selectedCornerIndex = -1;
        }

        draw();
        pushToHistory(); 
        updateButtonStates();
    }
}
function clearHistory() {
    history = [];
    future = [];
    updateUndoRedoButtons();
}
function toggleSnapMode() {
    snapMode = !snapMode;
    document.getElementById('snap-toggle').textContent = snapMode ? 'Snap Mode ON' : 'Snap Mode OFF';
    if (!snapMode && currentMode=='add' && currentPolygon.length > 0) {
        currentSnapPoint = null;
        draw();
    }
    if (!snapMode && currentMode === 'edit') {
        setMode(null); 
    }
    if (snapMode) {
        console.log("Snap mode enabled");
        alert("Snap mode is now enabled. Points will snap to the nearest white line.");
    } else {
        console.log("Snap mode disabled");
        alert("Snap mode is now disabled. Points can be placed freely.");
    }
}
function requestSnapPoint(mousePos) {
    if (throttleTimer) clearTimeout(throttleTimer);

    throttleTimer = setTimeout(() => {
        $.ajax({
            url: '/snap_to_white_line',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ point: [mousePos.x, mousePos.y] }),
            success: function(response) {
                if (response.snapped_point) {
                    currentSnapPoint = response.snapped_point;
                    draw();
                } else {
                    currentSnapPoint = null;
                    draw();
                }
            },
            error: function(xhr, status, error) {
                console.error('Error fetching snap point:', error);
                currentSnapPoint = null;
                draw();
            }
        });
    }, 100);
}

// Undo/Redo Functions
function updateButtonStates() {
    const isPolygonSelected = selectedPolygon !== null;

    switch (currentMode) {
        case 'edit':
            document.getElementById('delete-btn').disabled = !isPolygonSelected;
            document.getElementById('change-label-btn').disabled = !isPolygonSelected;
            document.getElementById('delete-btn').style.display = 'inline-block';
            document.getElementById('change-label-btn').style.display = 'inline-block';
            document.getElementById('undoButton').disabled = history.length <= 1;
            document.getElementById('redoButton').disabled = future.length === 0;
            document.getElementById('add-btn').disabled = false;
            document.getElementById('edit-controls').style.display = 'none';
            document.getElementById('save-controls').style.display = 'inline-block';
            document.getElementById('snap-toggle').style.display = 'none';
            document.getElementById('undoButton').style.display = 'inline-block';  
            document.getElementById('redoButton').style.display = 'inline-block';  
            document.getElementById('clearAllButton').style.display = 'inline-block';  
            break;

        case 'add':
            document.getElementById('delete-btn').style.display = 'none';
            document.getElementById('change-label-btn').style.display = 'none';
            document.getElementById('undoButton').disabled = history.length <= 1;
            document.getElementById('redoButton').disabled = future.length === 0;
            document.getElementById('add-btn').disabled = true;
            document.getElementById('edit-controls').style.display = 'none';
            document.getElementById('save-controls').style.display = 'inline-block';
            document.getElementById('snap-toggle').style.display = 'inline-block';
            document.getElementById('undoButton').style.display = 'inline-block';  
            document.getElementById('redoButton').style.display = 'inline-block';  
            document.getElementById('clearAllButton').style.display = 'inline-block';  
            break;

        case 'entrance':
        case 'destination':
            document.getElementById('delete-btn').style.display = 'none';
            document.getElementById('change-label-btn').style.display = 'none';
            document.getElementById('undoButton').disabled = history.length <= 1;
            document.getElementById('redoButton').disabled = future.length === 0;
            document.getElementById('add-btn').disabled = false;
            document.getElementById('edit-controls').style.display = 'none';
            document.getElementById('save-controls').style.display = 'inline-block';
            document.getElementById('snap-toggle').style.display = 'none';
            document.getElementById('undoButton').style.display = 'none';  
            document.getElementById('redoButton').style.display = 'none';  
            document.getElementById('clearAllButton').style.display = 'none';  
            break;

        default: 
            document.getElementById('delete-btn').style.display = 'none';
            document.getElementById('change-label-btn').style.display = 'none';
            document.getElementById('undoButton').disabled = history.length <= 1;
            document.getElementById('redoButton').disabled = future.length === 0;
            document.getElementById('add-btn').disabled = false;
            document.getElementById('edit-controls').style.display = 'inline-block';
            document.getElementById('save-controls').style.display = 'none';
            document.getElementById('snap-toggle').style.display = 'none';
            break;
    }
}
function updateUndoRedoButtons() {
    document.getElementById('undoButton').disabled = history.length <= 1;
    document.getElementById('redoButton').disabled = future.length === 0;
}
function updateSelectionOnUndoRedo(state) {
    if (selectedIndex !== -1 && polygons[selectedIndex]) {
        selectedPolygon = polygons[selectedIndex];
    } else {
        selectedPolygon = null;
        selectedIndex = -1;
        selectedCornerIndex = -1;
    }
    updateButtonStates();
    draw(); 
}

function drawEntrance() {
    if (!entrance) {
        entrance = { startX: 10, startY: 60, endX: 110, endY: 120 }; 
    }
    drawRectangle(entrance, 'rgba(0, 255, 0, 0.3)');
    drawPointers(entrance);
}
function drawDestination() {
    if (!destination) {
        destination = { startX: canvas.width - 110, startY: 60, endX: canvas.width - 10, endY: 120 };
    }
    drawRectangle(destination, 'rgba(255, 0, 0, 0.3)');
    drawPointers(destination);
}
function findSelectedCornerRectangle(pos, rect) {
    const threshold = 10; 
    const corners = [
        { x: rect.startX, y: rect.startY },
        { x: rect.endX, y: rect.startY },
        { x: rect.endX, y: rect.endY },
        { x: rect.startX, y: rect.endY }
    ];
    
    return corners.findIndex(corner =>
        Math.sqrt(Math.pow(corner.x - pos.x, 2) + Math.pow(corner.y - pos.y, 2)) <= threshold);
}
