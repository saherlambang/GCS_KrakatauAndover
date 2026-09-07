// ============================================================
// GPS TELEMETRY CLIENT
// ============================================================
const GPSData = {
    data: {
        lat: null,
        lon: null,
        speed: null,
        course: null,
        heading: null,
        fix: false
    },
    pathHistory: [],
    MAX_PATH_LENGTH: 200,
    fetchInProgress: false,
    lastSuccessfulFetch: null,
    visualPosition: null,
    visualHistory: [],
    lastMotionTime: null,
    sessionId: null,
    initialHeadingOffset: null,
    relativeHeading: null,
    geofence: {
        enabled: true,
        centerLat: -5.370700, // Titik tengah arena
        centerLon: 105.299875,
        radiusMeter: 35 // Radius 35 meter dari tengah arena
    },
    geofenceViolation: false,
    geofenceDistance: 0,

    // Kalibrasi skala: berapa meter jarak ASLI yang setara dengan 1 unit jarak
    // di jalur (misal dari kolom A ke kolom B, atau baris 1 ke baris 2).
    METERS_PER_GRID_UNIT: 11.1,

    // Knob tambahan: kalau animasi masih terasa ketinggalan/kecepetan
    // dibanding kapal asli setelah konversi knot->m/s, tinggal naikkan
    // atau turunkan angka ini (1.0 = tidak ada pengali tambahan).
    SPEED_MULTIPLIER: 1.8,

    // 1 knot = 0.514444 m/s
    KNOTS_TO_MPS: 0.514444,

    normalizeTelemetry(data) {
        const telemetry = data || {};
        const speed = telemetry.speed ?? telemetry.speed_knots ?? null;
        return {
            ...telemetry,
            lat: telemetry.lat ?? telemetry.latitude ?? null,
            lon: telemetry.lon ?? telemetry.longitude ?? null,
            speed,
            course: telemetry.course ?? telemetry.course_over_ground ?? null,
            fix: Boolean(telemetry.fix ?? telemetry.gps_valid)
        };
    },

    checkGeofence(lat, lon) {
        if (!this.geofence.enabled || !lat || !lon) return;
        const R = 6371e3; // Radius bumi dalam meter
        const lat1 = this.geofence.centerLat * Math.PI / 180;
        const lat2 = lat * Math.PI / 180;
        const deltaLat = (lat - this.geofence.centerLat) * Math.PI / 180;
        const deltaLon = (lon - this.geofence.centerLon) * Math.PI / 180;

        const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distance = R * c;

        this.geofenceDistance = distance;
        this.geofenceViolation = distance > this.geofence.radiusMeter;
    },

    updateVisualMotion(data) {
        const now = performance.now();
        const elapsed = this.lastMotionTime === null ? 0 : Math.min((now - this.lastMotionTime) / 1000, 1);

        // data.speed / speed_knots datang dalam KNOT (lihat panel Vehicle Data:
        // "Speed Over Ground ... knots"). Kita konversi ke m/s dulu sebelum
        // dipakai untuk animasi, baru dikalikan SPEED_MULTIPLIER sebagai
        // penyesuaian tambahan kalau masih terasa kurang/lebih cepat.
        const rawSpeed = Number(data.speed) || Number(data.motor_speed_mps) || Number(data.gps_speed_mps) || 0;
        const isLikelyKnots = data.speed !== undefined || data.speed_knots !== undefined;
        const speedMps = isLikelyKnots ? rawSpeed * this.KNOTS_TO_MPS : rawSpeed;
        const speed = speedMps * this.SPEED_MULTIPLIER;

        const lane = new URLSearchParams(window.location.search).get('lane') || 'A';

        // Koordinat memakai skala grid yang sama dengan label kolom/baris di canvas:
        // x = indeks kolom (0=A ... 4=E), y = nomor baris (1=Start/Finish ... 5=baris atas)
        const waypoints = lane === 'B' ? [
            // LINTASAN B
            { x: 0.0, y: 1.0 },   // 1. Start/Finish (A1)
            { x: 0.0, y: 3.0 },   // 2. Approach obstacle kiri (A3)
            { x: -0.13, y: 3.5 },  // 3. Mid obstacle kiri (zigzag)
            { x: 0.0, y: 4.0 },   // 4. Exit obstacle kiri (A4)
            { x: 0.0, y: 4.7 },   // 5. Menuju baris atas (dekat A5)
            { x: 4.0, y: 4.7 },   // 6. Menyeberang baris atas ke kolom E (dekat E5)
            { x: 4.0, y: 4.0 },   // 7. Approach obstacle kanan (E4)
            { x: 3.87, y: 3.5 },   // 8. Mid obstacle kanan (zigzag)
            { x: 4.0, y: 3.0 },   // 9. Exit obstacle kanan (E3)
            { x: 3.94, y: 2.0 },   // 10. Box B (E2)
            { x: 0.0, y: 1.0 }    // 11. Kembali ke Start/Finish (A1)
        ] : [
            // LINTASAN A
            { x: 4.0, y: 1.0 },   // 1. Start/Finish (E1)
            { x: 4.0, y: 3.0 },   // 2. Approach obstacle kanan (E3)
            { x: 3.87, y: 3.5 },   // 3. Mid obstacle kanan (zigzag)
            { x: 4.0, y: 4.0 },   // 4. Exit obstacle kanan (E4)
            { x: 4.0, y: 4.7 },   // 5. Menuju baris atas (dekat E5)
            { x: 0.0, y: 4.7 },   // 6. Menyeberang baris atas ke kolom A (dekat A5)
            { x: 0.0, y: 4.0 },   // 7. Approach obstacle kiri (A4)
            { x: -0.13, y: 3.5 },  // 8. Mid obstacle kiri (zigzag)
            { x: 0.0, y: 3.0 },   // 9. Exit obstacle kiri (A3)
            { x: 0.06, y: 2.0 },   // 10. Box A (A2)
            { x: 4.0, y: 1.0 }    // 11. Kembali ke Start/Finish (E1)
        ];

        if (this.currentDistance === undefined) {
            this.currentDistance = 0;
            this.visualPosition = { ...waypoints[0] };
        }

        if (elapsed > 0 && speed > 0.1) {
            const movement = (speed * elapsed) / this.METERS_PER_GRID_UNIT;
            this.currentDistance += movement;
        }

        let distLeft = this.currentDistance;
        let pos = { ...waypoints[0] };
        let currentHeading = null;

        for (let i = 0; i < waypoints.length - 1; i++) {
            const p1 = waypoints[i];
            const p2 = waypoints[i + 1];
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const segmentLen = Math.sqrt(dx * dx + dy * dy);

            if (distLeft <= segmentLen || i === waypoints.length - 2) {
                const ratio = Math.min(distLeft / segmentLen, 1.0);
                pos.x = p1.x + dx * ratio;
                pos.y = p1.y + dy * ratio;

                currentHeading = Math.atan2(dx, dy) * 180 / Math.PI;
                if (currentHeading < 0) currentHeading += 360;
                break;
            } else {
                distLeft -= segmentLen;
            }
        }

        this.visualPosition = pos;
        this.visualHeading = currentHeading;

        this.lastMotionTime = now;
        const lastPoint = this.visualHistory[this.visualHistory.length - 1];
        if (!lastPoint || Math.abs(lastPoint.x - this.visualPosition.x) > 0.001 || Math.abs(lastPoint.y - this.visualPosition.y) > 0.001) {
            this.visualHistory.push({ ...this.visualPosition });
            if (this.visualHistory.length > this.MAX_PATH_LENGTH) this.visualHistory.shift();
        }
    },

    resetForNewSession() {
        this.pathHistory = [];
        this.visualHistory = [];
        this.visualPosition = null;
        this.visualHeading = null;
        this.lastMotionTime = null;
        this.initialHeadingOffset = null;
        this.relativeHeading = null;
        this.currentDistance = 0;
    },

    async fetch() {
        if (this.fetchInProgress) return;
        this.fetchInProgress = true;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4500);

        try {
            const response = await fetch(CONFIG.TELEMETRY, {
                method: 'GET',
                cache: 'no-cache',
                signal: controller.signal
            });
            if (!response.ok) throw new Error('GPS telemetry request failed');

            const data = this.normalizeTelemetry(await response.json());
            if (data.session_id && this.sessionId && data.session_id !== this.sessionId) {
                this.resetForNewSession();
            }
            if (data.session_id) this.sessionId = data.session_id;
            this.data = data;
            this.lastSuccessfulFetch = Date.now();
            this.updateVisualMotion(data);

            if (data.fix && Number.isFinite(Number(data.lat)) && Number.isFinite(Number(data.lon))) {
                const point = {
                    lat: Number(data.lat),
                    lon: Number(data.lon)
                };

                this.checkGeofence(point.lat, point.lon);

                const lastPoint = this.pathHistory[this.pathHistory.length - 1];

                if (!lastPoint || lastPoint.lat !== point.lat || lastPoint.lon !== point.lon) {
                    this.pathHistory.push(point);
                    if (this.pathHistory.length > this.MAX_PATH_LENGTH) this.pathHistory.shift();
                }
            }
        } catch (error) {
            console.error('[GCS] Error fetching GPS telemetry:', error);
            this.data = {
                ...this.data,
                gps_valid: false
            };
        } finally {
            clearTimeout(timeoutId);
            this.fetchInProgress = false;
        }

        if (window.VehicleState) window.VehicleState.render(this.data);
        if (window.VehicleState) window.VehicleState.pathHistory = this.pathHistory;
        if (window.GPSRenderer) window.GPSRenderer.draw();
    },

};

window.GPSData = GPSData;
setInterval(() => GPSData.fetch(), CONFIG.POLL_INTERVALS.TELEMETRY);
GPSData.fetch();