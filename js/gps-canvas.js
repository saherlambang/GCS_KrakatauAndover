// ============================================================
// GPS CANVAS & ARENA RENDERER
// ============================================================
const GPSRenderer = {
    canvas: document.getElementById('gps-canvas'),
    ctx: null,
    minLat: -5.397340,
    maxLat: -5.396940,
    minLon: 105.266589,
    maxLon: 105.266989,
    plotLeft: 38,
    plotRight: 38,
    plotTop: 28,
    plotBottom: 42,

    init() {
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.resize();
        window.addEventListener('resize', () => this.resize());
    },

    resize() {
        if (!this.canvas || !this.ctx) return;
        const rect = this.canvas.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            const dpr = window.devicePixelRatio || 1;
            this.canvas.width = Math.round(rect.width * dpr);
            this.canvas.height = Math.round(rect.height * dpr);
            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        this.draw();
    },

    mapLonToX(lon, W) {
        return this.plotLeft + ((lon - this.minLon) / (this.maxLon - this.minLon)) * (W - this.plotLeft - this.plotRight);
    },

    mapLatToY(lat, H) {
        return this.plotTop + ((this.maxLat - lat) / (this.maxLat - this.minLat)) * (H - this.plotTop - this.plotBottom);
    },

    getGeographicBounds() {
        const gps = window.GPSData;
        const telemetry = gps ? gps.data : null;
        const points = gps ? [...gps.pathHistory] : [];
        const current = telemetry && Number.isFinite(Number(telemetry.lat))
            && Number.isFinite(Number(telemetry.lon))
            ? { lat: Number(telemetry.lat), lon: Number(telemetry.lon) }
            : null;

        if (current) points.push(current);
        if (!points.length) return null;

        const latitudes = points.map(point => point.lat);
        const longitudes = points.map(point => point.lon);
        const latCenter = (Math.min(...latitudes) + Math.max(...latitudes)) / 2;
        const lonCenter = (Math.min(...longitudes) + Math.max(...longitudes)) / 2;
        const latSpan = Math.max(Math.max(...latitudes) - Math.min(...latitudes), 0.0001);
        const lonSpan = Math.max(Math.max(...longitudes) - Math.min(...longitudes), 0.0001);

        return {
            minLat: latCenter - latSpan * 0.6,
            maxLat: latCenter + latSpan * 0.6,
            minLon: lonCenter - lonSpan * 0.6,
            maxLon: lonCenter + lonSpan * 0.6,
            points,
            current
        };
    },

    mapGeographicPoint(point, bounds, W, H) {
        const x = this.plotLeft + ((point.lon - bounds.minLon) / (bounds.maxLon - bounds.minLon))
            * (W - this.plotLeft - this.plotRight);
        const y = this.plotTop + ((bounds.maxLat - point.lat) / (bounds.maxLat - bounds.minLat))
            * (H - this.plotTop - this.plotBottom);
        return { x, y };
    },

    draw() {
        if (!this.canvas || !this.ctx) return;
        const ctx = this.ctx;
        const rect = this.canvas.getBoundingClientRect();
        const W = rect.width || 400;
        const H = rect.height || 300;
        const lane = window.GCSApp ? window.GCSApp.getCurrentLane() : 'A';

        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = 'rgba(246, 245, 250, 0.9)';
        ctx.fillRect(0, 0, W, H);

        const COL_W = Math.min(100, (W - 80) / 4);
        const ROW_H = Math.min(68, (H - 80) / 4);
        const MARGIN_L = (W - COL_W * 4) / 2;
        const MARGIN_T = (H - ROW_H * 4) / 2;

        this.plotLeft = MARGIN_L - 20;
        this.plotRight = MARGIN_L - 20;
        this.plotTop = MARGIN_T;
        this.plotBottom = H - (MARGIN_T + ROW_H * 4);

        // cx: menerima indeks kolom (0=A ... 4=E)
        // ry: menerima nomor baris (1=baris1/Start-Finish ... 5=baris atas)
        // Keduanya fungsi linear, jadi juga valid untuk nilai desimal / sedikit
        // di luar 0-4 & 1-5 (dipakai titik obstacle/zigzag pada GPSData).
        const cx = col => MARGIN_L + col * COL_W;
        const ry = row => MARGIN_T + (5 - row) * ROW_H;

        // Grid Lines & Labels
        ctx.save();
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.07)';
        ctx.lineWidth = 0.5;
        const colLabels = ['A', 'B', 'C', 'D', 'E'];
        const rowLabels = ['5', '4', '3', '2', '1'];

        for (let i = 0; i < 5; i++) {
            ctx.beginPath();
            ctx.moveTo(cx(i), ry(5) - 8);
            ctx.lineTo(cx(i), ry(1) + 30);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(cx(0) - 15, ry(5 - i));
            ctx.lineTo(cx(4) + 15, ry(5 - i));
            ctx.stroke();
        }

        ctx.fillStyle = '#130f0f';
        ctx.font = '11px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        colLabels.forEach((label, i) => ctx.fillText(label, cx(i), ry(5) - 12));

        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        rowLabels.forEach((label, i) => ctx.fillText(label, cx(0) - 22, ry(5 - i)));
        ctx.restore();

        // Marker Helpers
        const drawBuoy = (x, y, color, radius = 5) => {
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
        };

        const drawBlock = (x, y, w, h, color) => {
            ctx.fillStyle = color;
            ctx.fillRect(x - w / 2, y - h / 2, w, h);
        };

        const drawLabel = (x, y, text, bgColor) => {
            ctx.fillStyle = bgColor;
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(x - 36, y - 11, 72, 22, 4);
            else ctx.rect(x - 36, y - 11, 72, 22);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 10px Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, x, y);
        };

        const drawStartFinish = (x, y) => {
            ctx.beginPath();
            ctx.ellipse(x, y, 34, 17, 0, 0, Math.PI * 2);
            ctx.fillStyle = '#0284c7';
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 9px Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Start /', x, y - 5);
            ctx.fillText('Finish', x, y + 6);
        };

        const drawNavDots = (x, y) => {
            for (let i = 0; i < 3; i++) drawBuoy(x, y - i * 8, '#555', 2.5);
        };

        const RED = '#ef4444', GREEN = '#22c55e', DARK_BLUE = '#1a56db';

        // Baris lurus (B, C, D): jarak vertikal hijau-merah diperlebar dari
        // 15px (ry(5)+5 / ry(5)+20) menjadi 28px, supaya pasangan bola terlihat
        // lebih renggang. Hanya blok ini yang diubah — pasangan zigzag di
        // kolom A dan E (dekat start/finish) tetap seperti semula.
        const greenTopY = ry(5) + 2, redTopY = ry(5) + 30;

        [cx(1) + 20, cx(2) - 18, cx(2) + 18, cx(3) - 20].forEach(x => {
            drawBuoy(x, greenTopY, GREEN, 4.5);
            drawBuoy(x, redTopY, RED, 4.5);
        });

        const yLeftMid = (ry(4) + ry(3)) / 2;
        [
            { rX: cx(0) + 12, gX: cx(0) - 12, y: ry(4) - 5 },
            { rX: cx(0) + 4, gX: cx(0) - 30, y: yLeftMid },
            { rX: cx(0) + 12, gX: cx(0) - 12, y: ry(3) + 5 }
        ].forEach(p => {
            drawBuoy(p.rX, p.y, RED, 4.5);
            drawBuoy(p.gX, p.y, GREEN, 4.5);
        });

        [
            { rX: cx(4) - 12, gX: cx(4) + 12, y: ry(4) - 5 },
            { rX: cx(4) - 25, gX: cx(4) + 4, y: yLeftMid },
            { rX: cx(4) - 12, gX: cx(4) + 12, y: ry(3) + 5 }
        ].forEach(p => {
            drawBuoy(p.rX, p.y, RED, 4.5);
            drawBuoy(p.gX, p.y, GREEN, 4.5);
        });

        // Arena Objects
        if (lane === 'A') {
            drawBlock(cx(0) + 5, ry(2), 28, 16, DARK_BLUE);
            drawBlock(cx(1) + 5, ry(1) + 5, 26, 14, GREEN);
            drawLabel(cx(2) + 10, ry(1) + 5, 'Lintasan A', RED);
            drawStartFinish(cx(4), ry(1) + 10);
            drawNavDots(cx(4), ry(1) - 8);
        } else {
            drawStartFinish(cx(0), ry(1) + 10);
            drawNavDots(cx(0), ry(1) - 8);
            drawBlock(cx(4) - 5, ry(2), 28, 16, DARK_BLUE);
            drawBlock(cx(3) - 5, ry(1) + 5, 26, 14, GREEN);
            drawLabel(cx(2) - 10, ry(1) + 5, 'Lintasan B', '#16a34a');
        }

        // Actual Trajectory (visual position, skala grid GPSData: x=kolom 0-4, y=baris 1-5)
        const visualHistory = window.GPSData ? window.GPSData.visualHistory : [];
        if (visualHistory.length > 0) {
            const toHistX = (x) => cx(x);
            const toHistY = (y) => ry(y);

            ctx.beginPath();
            ctx.strokeStyle = 'rgba(30, 64, 175, 0.6)';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);

            visualHistory.forEach((pt, idx) => {
                const x = toHistX(pt.x);
                const y = toHistY(pt.y);
                if (idx === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            if (visualHistory.length > 1) ctx.stroke();
            ctx.setLineDash([]);

            visualHistory.forEach(pt => {
                const x = toHistX(pt.x);
                const y = toHistY(pt.y);
                ctx.beginPath();
                ctx.arc(x, y, 3, 0, Math.PI * 2);
                ctx.fillStyle = '#1e40af';
                ctx.fill();
            });
        }

        // Ship Icon & Heading (skala grid GPSData: x=kolom 0-4, y=baris 1-5)
        const tel = window.GPSData ? window.GPSData.data : null;
        const visualPosition = window.GPSData ? window.GPSData.visualPosition : null;
        let shipX, shipY;

        if (visualPosition && Number.isFinite(visualPosition.x) && Number.isFinite(visualPosition.y)) {
            shipX = cx(visualPosition.x);
            shipY = ry(visualPosition.y);
        } else {
            shipX = lane === 'A' ? cx(4) : cx(0);
            shipY = ry(1) + 10;
        }

        // Heading kapal: pakai arah jalur hasil perhitungan (visualHeading) kalau
        // ada, kalau tidak fallback ke heading/course dari telemetry asli.
        const visualHeading = window.GPSData ? window.GPSData.visualHeading : null;
        const heading = Number.isFinite(Number(visualHeading))
            ? Number(visualHeading)
            : (tel ? Number(tel.heading ?? tel.course) : null);
        const headingRadians = Number.isFinite(heading)
            ? (heading - 90) * (Math.PI / 180)
            : 0;

        // Draw the vessel with canvas primitives so it works without emoji fonts.
        ctx.save();
        ctx.translate(shipX, shipY);
        ctx.rotate(headingRadians);
        ctx.beginPath();
        ctx.moveTo(16, 0);
        ctx.lineTo(7, -8);
        ctx.lineTo(-12, -8);
        ctx.lineTo(-16, 0);
        ctx.lineTo(-12, 8);
        ctx.lineTo(7, 8);
        ctx.closePath();
        ctx.fillStyle = '#0f766e';
        ctx.fill();
        ctx.strokeStyle = '#083344';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(-7, -5, 9, 10);
        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(2, -3, 5, 6);
        ctx.restore();

        if (Number.isFinite(heading) && visualPosition) {
            const len = 25;
            ctx.beginPath();
            ctx.moveTo(shipX, shipY);
            ctx.lineTo(shipX + Math.cos(headingRadians) * len, shipY + Math.sin(headingRadians) * len);
            ctx.strokeStyle = '#79c0ff';
            ctx.lineWidth = 3;
            ctx.stroke();
        }

        // COG (kalau ada telemetry asli) menunjukkan arah pergerakan sebenarnya.
        if (tel && Number.isFinite(Number(tel.course)) && visualPosition) {
            const movementRad = (Number(tel.course) - 90) * (Math.PI / 180);
            const movementLength = 16;
            ctx.beginPath();
            ctx.moveTo(shipX, shipY);
            ctx.lineTo(shipX + Math.cos(movementRad) * movementLength, shipY + Math.sin(movementRad) * movementLength);
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 2;
            ctx.setLineDash([3, 3]);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        ctx.fillStyle = '#6B5C52';
        ctx.font = 'bold 12px Tahoma, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(`LINTASAN ${lane}`, W / 2, 8);
    }
};

window.GPSRenderer = GPSRenderer;