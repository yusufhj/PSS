# Admin log in details
# Email: admin@gmail.com
# Password: 123456

# User log in details
# Email: user@gmail.com
# Password: 123456


from flask import Flask, jsonify, request, send_from_directory, Response, render_template, current_app
from flask_cors import CORS
import cv2
import numpy as np
import os
from datetime import datetime, timedelta
import firebase_admin
from firebase_admin import credentials, db
import json
import networkx as nx
import time


app = Flask(__name__)
CORS(app)

VIDEO_FILE = 'dist/static/carPark.mp4'
FRAME_FILE = 'dist/static/captured_frame.jpg'
RESERVATION_FILE = './data/reservations.json'
ENTRANCE_JSON_FILE = './data/entrance.json'
DESTINATION_JSON_FILE = './data/destination.json'
PARKS_JSON_FILE = './data/parks.json'

PARKS = '/polygons'
DESTINATION = '/destination'
ENTRANCE = '/entrance'
RESERVATIONS = '/reservations'


cap = cv2.VideoCapture(VIDEO_FILE)
if not cap.isOpened():
    raise IOError("Cannot open video file")

orb = cv2.ORB_create(nfeatures=1000)
backSub = cv2.createBackgroundSubtractorMOG2(history=500, varThreshold=25, detectShadows=False)
spot_status = {}
current_frame_buffer = None

cred = credentials.Certificate(r'./data/park.json')
firebase_admin.initialize_app(cred, {
    'databaseURL': 'https://parkingsystem-b73f9-default-rtdb.firebaseio.com/'
})


def load_data_from_firebase(path):
    try:
        ref = db.reference(path)
        data = ref.get()
        if data:
            return data
        else:
            print("No data found at specified path.")
            return {}
    except Exception as e:
        print(f"Failed to load data from Firebase Realtime Database: {e}")
        return {}

def save_data_to_firebase(path, data):
    try:
        ref = db.reference(path)
        ref.set(data)
        print("Data saved successfully to Firebase Realtime Database.")
    except Exception as e:
        print(f"Error saving data to Firebase Realtime Database: {e}")


def load_data_from_file(filename):
    """Loads data from a JSON file."""
    try:
        with open(filename, 'r') as file:
            data = json.load(file)
            return data
    except Exception as e:
        print(f"Failed to load data from {filename}: {e}")
        return {}

def save_data_to_file(filename, data):
    """Saves data to a JSON file."""
    try:
        with open(filename, 'w') as file:
            json.dump(data, file, indent=4)
    except Exception as e:
        print(f"Error saving data to {filename}: {e}")

import threading

def process_video():
    global spot_status
    # polygons = load_data_from_firebase(PARKS)
    polygons = load_data_from_file(PARKS_JSON_FILE)
    spot_status = {poly['label']: {'status': 'free', 'entry_time': None, 'total_time': 0} for poly in polygons}

    first_frame_descriptors = None  

    while True:
        ret, current_frame = cap.read()
        if not ret:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)  
            continue

        current_time = datetime.now()
        gray_current_frame = cv2.cvtColor(current_frame, cv2.COLOR_BGR2GRAY)
        imgThreshold = cv2.adaptiveThreshold(gray_current_frame, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 25, 16)
        current_keypoints, current_descriptors = orb.detectAndCompute(gray_current_frame, None)

        if first_frame_descriptors is None:
            first_frame_keypoints = current_keypoints
            first_frame_descriptors = current_descriptors
            continue

        if current_descriptors is not None and first_frame_descriptors is not None:
            matcher = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
            matches = matcher.match(first_frame_descriptors, current_descriptors)

            if len(matches) > 4:
                src_pts = np.float32([first_frame_keypoints[m.queryIdx].pt for m in matches]).reshape(-1, 1, 2)
                dst_pts = np.float32([current_keypoints[m.trainIdx].pt for m in matches]).reshape(-1, 1, 2)
                matrix, _ = cv2.findHomography(src_pts, dst_pts, cv2.RANSAC, 5.0)

                for polygon in polygons:
                    transformed_points = cv2.perspectiveTransform(np.float32([polygon['points']]).reshape(-1, 1, 2), matrix)
                    transformed_polygon = {'points': transformed_points.reshape(-1, 2).astype(int).tolist()}
                    occupied = check_occupancy(imgThreshold, transformed_polygon)
                    label = polygon['label']
                    spot = spot_status[label]

                    if occupied:
                        if spot['status'] in ['free', 'reserved empty']:
                            spot['status'] = 'occupied'
                            spot['entry_time'] = current_time
                        elif spot['status'] == 'reserved':
                            spot['status'] = 'reserved occupied'
                            spot['entry_time'] = current_time
                    else:
                        if spot['status'] in ['occupied', 'reserved occupied'] and (current_time - spot['entry_time']).total_seconds() >= 1:
                            spot['status'] = 'free' if spot['status'] == 'occupied' else 'reserved empty'
                            spot['entry_time'] = None

                    color = (0, 0, 255) if occupied else (0, 255, 0)
                    cv2.polylines(current_frame, [np.int32(transformed_points)], True, color, 3)

        _, buffer = cv2.imencode('.jpg', current_frame)
        global current_frame_buffer
        current_frame_buffer = buffer.tobytes()
        time.sleep(0.1)


video_thread = threading.Thread(target=process_video)
video_thread.daemon = True
video_thread.start()



def check_occupancy(thresh, polygon, change_threshold=0.1):
    if np.mean(thresh) < change_threshold:
        return False  

    polygon_points = np.array(polygon['points'], dtype=np.int32)
    mask = np.zeros(thresh.shape, dtype=np.uint8)
    cv2.fillPoly(mask, [polygon_points], 255)
    masked_area = cv2.bitwise_and(thresh, thresh, mask=mask)
    occupied_area = cv2.countNonZero(masked_area)
    total_area = cv2.contourArea(polygon_points)
    return (occupied_area / total_area > 0.15) if total_area > 0 else False

@app.route('/video_feed')
def video_feed():
    def generate():
        while True:
            if current_frame_buffer:
                yield (b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + current_frame_buffer + b'\r\n')
            time.sleep(0.1) 

    return Response(generate(), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/get_parking_status')
def get_parking_status():
    result = {}
    current_time = datetime.now()
    reservations = load_data_from_file(RESERVATION_FILE)
    
    for label, info in spot_status.items():
        reserved = False
        for reservation in reservations.get(label, []):
            start = datetime.strptime(reservation['start'], '%Y-%m-%dT%H:%M:%S')
            expiry = datetime.strptime(reservation['expiry'], '%Y-%m-%dT%H:%M:%S')
            if start <= current_time <= expiry:
                remaining_seconds = (expiry - current_time).total_seconds()
                result[label] = {
                    'status': 'reserved occupied' if info['status'] == 'occupied' else 'reserved empty',
                    'time_left': remaining_seconds
                }
                reserved = True
                break
        
        if not reserved:
            if info['status'] == 'occupied':
                elapsed_time = (current_time - info['entry_time']).total_seconds()
                result[label] = {
                    'status': 'occupied',
                    'time_parked': elapsed_time
                }
            else:
                result[label] = {
                    'status': 'free',
                    'time_parked': 0
                }
    
    return jsonify(result)

@app.route('/get_free_spots_count')
def get_free_spots_count():
    current_time = datetime.now()
    reservations = load_data_from_file(RESERVATION_FILE)
    
    free_count = 0
    for label, info in spot_status.items():
        is_reserved = False
        for reservation in reservations.get(label, []):
            start = datetime.strptime(reservation['start'], '%Y-%m-%dT%H:%M:%S')
            expiry = datetime.strptime(reservation['expiry'], '%Y-%m-%dT%H:%M:%S')
            if start <= current_time <= expiry:
                is_reserved = True
                break

        if info['status'] == 'free' and not is_reserved:
            free_count += 1

    return jsonify(free_count=free_count)

@app.route('/reserve_spot', methods=['POST'])
def reserve_spot():
    try:
        data = request.get_json()
        spot_id = data['spotId']
        start_time_str = data['startTime']
        duration = int(data['duration'])

        print(f"Attempting to reserve spot {spot_id} from {start_time_str} for {duration} hours.")

        start_datetime = datetime.strptime(start_time_str, '%Y-%m-%dT%H:%M:%S')
        expiry_datetime = start_datetime + timedelta(hours=duration)

        reservations = load_data_from_file(RESERVATION_FILE)
        if spot_id not in reservations:
            reservations[spot_id] = []

        for reservation in reservations[spot_id]:
            reservation_start = datetime.strptime(reservation['start'], '%Y-%m-%dT%H:%M:%S')
            reservation_expiry = datetime.strptime(reservation['expiry'], '%Y-%m-%dT%H:%M:%S')
            if (reservation_start <= start_datetime < reservation_expiry) or \
               (reservation_start < expiry_datetime <= reservation_expiry):
                print(f"Conflict: Existing reservation from {reservation_start} to {reservation_expiry}.")
                return jsonify({'success': False, 'message': 'Time slot already reserved'}), 409

        new_reservation = {
            'start': start_time_str,
            'expiry': expiry_datetime.strftime('%Y-%m-%dT%H:%M:%S')
        }
        reservations[spot_id].append(new_reservation)
        save_data_to_file(RESERVATION_FILE, reservations)

        return jsonify({'success': True, 'message': 'Reservation successful'})
    except Exception as e:
        print(f"Error processing reservation: {e}")
        return jsonify({'error': 'Internal Server Error'}), 500

@app.route('/get_reserved_times', methods=['GET'])
def get_reserved_times():
    spot_id = request.args.get('spotId')
    date_str = request.args.get('date')
    if not spot_id or not date_str:
        return jsonify({'error': 'Missing parameters'}), 400

    try:
        date = datetime.strptime(date_str, '%Y-%m-%d').date()
    except ValueError:
        return jsonify({'error': 'Invalid date format'}), 400

    reservations = load_data_from_file(RESERVATION_FILE)
    reserved_times = []
    if spot_id in reservations:
        for res in reservations[spot_id]:
            start_datetime = datetime.strptime(res['start'], '%Y-%m-%dT%H:%M:%S')
            expiry_datetime = datetime.strptime(res['expiry'], '%Y-%m-%dT%H:%M:%S')
            if start_datetime.date() <= date <= expiry_datetime.date():
                start_hour = start_datetime.hour if start_datetime.date() == date else 0
                end_hour = expiry_datetime.hour if expiry_datetime.date() == date else 23
                reserved_times.extend(range(start_hour, end_hour + 1))

    spot_info = spot_status.get(spot_id, {})
    if spot_info.get('status') == 'occupied' and spot_info.get('entry_time'):
        occupied_time = spot_info['entry_time']
        if occupied_time.date() == date:
            occupied_hour = occupied_time.hour
            occupied_end_hour = (occupied_time + timedelta(hours=1)).hour
            reserved_times.extend(range(occupied_hour, occupied_end_hour + 1))

    return jsonify({'reserved_times': sorted(set(reserved_times))})

@app.route('/find_nearest_free_to_destination', methods=['POST'])
def find_nearest_free_to_destination():
    try:
        data = request.get_json()
        if not data or 'destinationX' not in data or 'destinationY' not in data:
            return jsonify({'success': False, 'message': 'Missing destination coordinates'}), 400

        destination_x = data['destinationX']
        destination_y = data['destinationY']

        # polygons = load_data_from_firebase(PARKS)
        polygons = load_data_from_file(PARKS_JSON_FILE)
        G = nx.Graph()

        for poly in polygons:
            centroid = tuple(np.mean(poly['points'], axis=0)) 
            G.add_node(poly['label'], centroid=centroid, status=spot_status.get(poly['label'], {}).get('status', 'unknown'))

        nearest_free_spot = None
        min_distance = float('inf')
        for node, attributes in G.nodes(data=True):
            if attributes['status'] == 'free':
                node_centroid = attributes['centroid']
                distance = np.linalg.norm(np.array(node_centroid) - np.array([destination_x, destination_y]))
                print(f"Distance to {node}: {distance}")
                
                if distance < min_distance:
                    nearest_free_spot = node
                    min_distance = distance           

        if not nearest_free_spot:
            return jsonify({'success': False, 'message': 'No free spots available near destination'}), 404

        return jsonify({'success': True, 'nearest_free_spot': nearest_free_spot})
    except Exception as e:
        current_app.logger.error(f"Unexpected error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

def snap_to_white_line(image, point, search_radius=25):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    _, thresh = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY)
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    min_dist = float('inf')
    closest_point = None

    for contour in contours:
        for contour_point in contour[:, 0]:
            dist = np.linalg.norm(np.array(point) - np.array(contour_point))

            if dist < min_dist and dist < search_radius:
                min_dist = dist
                closest_point = tuple(contour_point)

    return closest_point

@app.route('/snap_to_white_line', methods=['POST'])
def handle_snap_to_white_line():
    data = request.json
    point = tuple(data['point'])
    image = cv2.imread(FRAME_FILE)

    if image is None:
        return jsonify({'error': 'Image not found'}), 404

    closest_point = snap_to_white_line(image, point)

    if closest_point is None:
        return jsonify({'error': 'No white line found'}), 404

    closest_point = [int(coord) for coord in closest_point]
    return jsonify({'snapped_point': closest_point})


@app.route('/capture_frame', methods=['POST'])
def capture_frame():
    success, frame = cap.read()
    if success:
        cv2.imwrite(os.path.join(app.static_folder, 'captured_frame.jpg'), frame)
        print("Frame captured successfully and saved to static/captured_frame.jpg")
        return jsonify({"message": "Frame captured successfully!"})
    else:
        print("Failed to capture frame")
        return jsonify({"message": "Failed to capture frame!"}), 500

@app.route('/static_frame')
def static_frame():
    return send_from_directory('static', os.path.basename(FRAME_FILE))

@app.route('/')
def index():
    return render_template('sign-in.html')

@app.route('/sign_up')
def sign_up():
    return render_template('sign_up.html')

@app.route('/sign_in')
def sign_in():
    return render_template('sign-in.html')


@app.route('/dashboard')
def dashboard():
    return render_template('dashboard.html')

@app.route('/live')
def live():
    return render_template('live.html')

@app.route('/abstract')
def abstract():
    return render_template('abstract.html')

@app.route('/abstract2')
def abstract2():
    return render_template('abstract2.html')


@app.route('/picker')
def picker():
    return render_template('picker.html')

@app.route('/reservation')
def reservation():
    return render_template('reservation.html')

@app.route('/reservation2')
def reservation2():
    return render_template('reservation2.html')

@app.route('/notifications')
def notifications():
    return render_template('notifications.html')

@app.route('/user')
def user():
    return render_template('user.html')


@app.route('/load_annotations')
def load_annotations():
    try:
        # polygons = load_data_from_firebase(PARKS)
        polygons = load_data_from_file(PARKS_JSON_FILE)
        entrance = load_data_from_file(ENTRANCE_JSON_FILE)
        destination = load_data_from_file(DESTINATION_JSON_FILE)
        return jsonify({'polygons': polygons, 'entrance': entrance, 'destination': destination})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/save_annotations', methods=['POST'])
def save_annotations():
    try:
        data = request.get_json()
        # save_data_to_firebase(PARKS, data['polygons'])
        save_data_to_file(PARKS_JSON_FILE, data.get('polygons', {}))
        save_data_to_file(ENTRANCE_JSON_FILE, data.get('entrance', {}))
        save_data_to_file(DESTINATION_JSON_FILE, data.get('destination', {}))
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500



if __name__ == "__main__":
    app.run(debug=True, threaded=True)