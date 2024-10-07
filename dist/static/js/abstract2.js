$(document).ready(function() {
    loadAbstractView(); 

    function updateFreeSpotsCount() {
        $.getJSON('/get_free_spots_count', function(data) {
            $('#free-spots-count').text('Free Spots: ' + data.free_count);  
        }).fail(function() {
            console.log('Error fetching the free spots count');
        });
    }

    function updateParkingStatus() {
        $.getJSON('/get_parking_status', function(statuses) {
            parkingStatuses = statuses;
            for (var label in statuses) {
                var spot = $('#spot-' + label);
                var spotInfo = statuses[label];

                var labelSpan = spot.find('.label');
                if (labelSpan.length === 0) {
                    labelSpan = $('<span>').addClass('label').text(label).appendTo(spot);
                }

                var timerSpan = spot.find('.timer');
                if (timerSpan.length === 0) {
                    timerSpan = $('<span>').addClass('timer').appendTo(spot);
                }

                spot.removeClass('occupied reserved occupied-reserved free').addClass(spotInfo.status);

                if (spotInfo.status === 'occupied') {
                    spot.css('background-color', '#FF0000'); 
                } else if (spotInfo.status === 'reserved occupied' || spotInfo.status === 'reserved empty') {
                    spot.css('background-color', '#1515c6'); 
                } else {
                    spot.css('background-color', '#4CAF50'); 
                }
            }
        }).fail(function() {
            console.error('Error fetching parking status');
        });
    }

    function formatTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secondsLeft = Math.floor(seconds % 60); 
        return `${hours}h ${minutes}m ${secondsLeft}s`;
    }

    updateFreeSpotsCount(); 
    updateParkingStatus(); 
    setInterval(updateParkingStatus, 1000); 
    setInterval(updateFreeSpotsCount, 5000); 
});


let parkingStatuses = {};
let globalEntrance = null;
let globalDestination = null;
let horizontalGaps = [];
let verticalGapsArray = [];
let columns = [];



function separatePolygonsIntoColumns(polygons) {
    polygons.sort((a, b) => Math.min(...a.points.map(point => point[0])) - Math.min(...b.points.map(point => point[0])));

    let columns = [];
    let currentColumn = [];
    let lastMaxX = -Infinity;
    let distances = [];

    polygons.forEach((polygon, index) => {
        if (index > 0) {
            const prevMaxX = Math.max(...polygons[index - 1].points.map(point => point[0]));
            const currentMinX = Math.min(...polygon.points.map(point => point[0]));
            distances.push(currentMinX - prevMaxX);
        }
    });

    const averageDistance = distances.reduce((a, b) => a + b, 0) / distances.length;
    const distanceThreshold = averageDistance * 0.85;

    polygons.forEach(polygon => {
        const minX = Math.min(...polygon.points.map(point => point[0]));
        if (minX - lastMaxX > distanceThreshold) {
            if (currentColumn.length) {
                columns.push(currentColumn);
                distances.push(minX - lastMaxX);
                currentColumn = [];
            }
        }
        currentColumn.push(polygon);
        lastMaxX = Math.max(...polygon.points.map(point => point[0]));
    });

    if (currentColumn.length) {
        columns.push(currentColumn);
    }

    return columns;
}

function findGapsBetweenColumns(columns) {
    const horizontalGaps = [];
    
    for (let i = 0; i < columns.length - 1; i++) {
        const lastColumn = columns[i];
        const nextColumn = columns[i + 1];

        const lastMaxX = Math.max(...lastColumn.map(p => Math.max(...p.points.map(point => point[0]))));
        const nextMinX = Math.min(...nextColumn.map(p => Math.min(...p.points.map(point => point[0]))));
        
        const lastMinX = Math.min(...lastColumn.map(p => Math.min(...p.points.map(point => point[0]))));
        const columnWidth = lastMaxX - lastMinX;

        const gap = nextMinX - lastMaxX;
        
        if (gap > columnWidth) {
            const start = lastMaxX; 
            const end = nextMinX; 
            horizontalGaps.push({ index: i, gap, start, end });
        }
    }

    return horizontalGaps;
}

function findGapsWithinColumns(columns) {
    return columns.map((column, columnIndex) => {
        const sortedSpots = column.sort((a, b) => Math.min(...a.points.map(point => point[1])) - Math.min(...b.points.map(point => point[1])));
        const verticalGaps = [];

        for (let j = 0; j < sortedSpots.length - 1; j++) {
            const lastMaxY = Math.max(...sortedSpots[j].points.map(point => point[1]));
            const nextMinY = Math.min(...sortedSpots[j + 1].points.map(point => point[1]));
            const gap = nextMinY - lastMaxY;
            const currentHeight = Math.max(...sortedSpots[j].points.map(point => point[1])) - Math.min(...sortedSpots[j].points.map(point => point[1]));
            if (gap > currentHeight/2) {
                verticalGaps.push({ column: columnIndex, row: j, gap });
            }
        }

        return verticalGaps;
    });
}

function getNearestFreeSpot() {
    if (!globalDestination) {
        console.error('Destination not set. Did you call loadAbstractView first?');
        return;
    }

    const data = {
        destinationX: globalDestination.startX,
        destinationY: globalDestination.startY
    };

    fetch('/find_nearest_free_to_destination', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error: ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        const resultContainer = document.getElementById('shortest-path');
        if (data.success) {
            highlightNearestFreeSpot(data.nearest_free_spot);
        } else {
            resultContainer.textContent = `Error: ${data.message}`;
            console.error('Failed to fetch nearest free spot:', data.message);
        }
    })
    .catch(error => {
        console.error('Error fetching nearest free spot:', error);
        document.getElementById('shortest-path').textContent = `Error: ${error.message}`;
    });
}

function highlightNearestFreeSpot(nearestSpotId) {
    $('.parking-spot').removeClass('nearest-free-spot');

    const nearestSpot = $('#spot-' + nearestSpotId);
    nearestSpot.addClass('nearest-free-spot');
    console.log('Class applied:', nearestSpot.hasClass('nearest-free-spot'));  
}


function loadAbstractView() {
    $.getJSON('/load_annotations', function(data) {
        columns = separatePolygonsIntoColumns(data.polygons);
        horizontalGaps = findGapsBetweenColumns(columns);
        verticalGapsArray = findGapsWithinColumns(columns);
        globalEntrance = data.entrance;
        globalDestination = data.destination;
        drawAbstractView(columns, horizontalGaps, verticalGapsArray);

    }).fail(function() {
        console.error('Error loading annotations');
    });
}

function drawAbstractView(columns, horizontalGaps, verticalGapsArray) {
    const parkingLot = $('#parking-lot').empty();
    const columnsContainer = $('<div>').addClass('columns-container').appendTo(parkingLot);

    columns.forEach((column, columnIndex) => {
        const columnDiv = $('<div>').addClass('column').appendTo(columnsContainer);
        
        const verticalGaps = verticalGapsArray[columnIndex];
        column.forEach((polygon, spotIndex) => {
            const spotDiv = $('<div>').addClass('parking-spot').attr('id', 'spot-' + polygon.label).appendTo(columnDiv);
            $('<span>').addClass('label').text(polygon.label).appendTo(spotDiv);
            
            const gapInfo = verticalGaps.find(gap => gap.row === spotIndex);
            if (gapInfo && gapInfo.gap > 0) {
                $('<div>').addClass('gap')
                .css({
                    'height': `3%`,
                })
                .appendTo(columnDiv);
            }
        });

    const horizontalGapInfo = horizontalGaps.find(gap => gap.index === columnIndex);
    if (horizontalGapInfo && horizontalGapInfo.gap > 0) {
        $('<div>').addClass('gap')
            .css({
                'flex': `0 0 3%`,
            })
            .appendTo(columnsContainer);
    }
    });

}




