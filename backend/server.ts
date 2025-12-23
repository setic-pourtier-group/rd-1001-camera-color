import { serve } from "bun";
import nodes7 from "nodes7";
import * as path from "path";
import * as fs from "fs";

// --- CONFIGURATION ---
const CONFIG = {
    PLC_IP: process.env.PLC_IP || "192.168.0.1",
    PLC_RACK: 0,
    PLC_SLOT: 1,
    USER: "admin",
    PASS: "setic",
    LOG_DIR: "./logs" // Dossier lié au SSD via Docker
};

// --- GESTION PLC (Siemens S7) ---
const conn = new nodes7();
let plcConnected = false;

const connectPLC = () => {
    conn.initiateConnection({ 
        port: 102, 
        host: CONFIG.PLC_IP, 
        rack: CONFIG.PLC_RACK, 
        slot: CONFIG.PLC_SLOT 
    }, (err) => {
        if (err) {
            console.log(`⚠️ PLC: Erreur connexion (${err}). Réessai dans 5s...`);
            plcConnected = false;
            setTimeout(connectPLC, 5000);
        } else {
            console.log(`✅ PLC: Connecté à ${CONFIG.PLC_IP}`);
            plcConnected = true;
            conn.setTranslationCB((tag) => { return [tag]; });
            conn.addItems('VISION_STOP', 'DB1,X0.0'); 
        }
    });
};
connectPLC();

const writePLC = async (stop: boolean) => {
    if (!plcConnected) return false;
    return new Promise((resolve) => {
        conn.writeItems('VISION_STOP', stop, (err) => {
            if (err) {
                console.error("Erreur écriture PLC", err);
                plcConnected = false;
                connectPLC();
                resolve(false);
            } else {
                resolve(true);
            }
        });
    });
};

// --- GESTION LOGS (SSD) ---
const writeLog = async (entry: any) => {
    if (!fs.existsSync(CONFIG.LOG_DIR)) fs.mkdirSync(CONFIG.LOG_DIR, { recursive: true });
    
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = path.join(CONFIG.LOG_DIR, `log_${dateStr}.csv`);
    const line = `${entry.ts};${entry.date};${entry.heure};${entry.etat};${entry.pixels}\n`;
    
    if (!fs.existsSync(filename)) {
        await Bun.write(filename, "Timestamp;Date;Heure;Etat;Pixels\n");
    }
    
    const file = Bun.file(filename);
    await Bun.write(filename, (await file.text()) + line);
};

// --- SERVEUR WEB (BUN) ---
serve({
    port: 3000,
    async fetch(req) {
        const url = new URL(req.url);
        
        // 1. STREAMING VIDEO (Raspberry Pi -> PC)
        if (url.pathname === "/api/video_stream") {
            // Lancement de FFmpeg pour capturer la caméra USB
            const ffmpeg = Bun.spawn([
                "ffmpeg",
                "-f", "v4l2",          // Format Linux Video
                "-framerate", "15",    // 15 FPS pour fluidité réseau
                "-video_size", "640x480",
                "-i", "/dev/video0",   // Entrée Caméra
                "-f", "mjpeg",         // Sortie MJPEG (facile à lire par navigateur)
                "-"
            ], {
                stdout: "pipe"
            });

            return new Response(ffmpeg.stdout, {
                headers: {
                    "Content-Type": "multipart/x-mixed-replace; boundary=ffmpeg",
                    "Cache-Control": "no-cache"
                }
            });
        }

        // 2. API ALARM (Reçu du PC)
        if (url.pathname === "/api/alarm" && req.method === "POST") {
            const body = await req.json();
            await writePLC(body.alarm);
            return new Response(JSON.stringify({ status: "OK" }));
        }

        // 3. API LOG (Reçu du PC)
        if (url.pathname === "/api/log" && req.method === "POST") {
            const body = await req.json();
            writeLog(body);
            return new Response("Logged");
        }

        // 4. LOGIN
        if (url.pathname === "/api/login" && req.method === "POST") {
            const body = await req.json();
            if (body.username === CONFIG.USER && body.password === CONFIG.PASS) {
                const headers = new Headers();
                headers.set("Set-Cookie", `session=logged_in; Path=/; Max-Age=86400`);
                return new Response("OK", { status: 200, headers });
            }
            return new Response("Unauthorized", { status: 401 });
        }

        // 5. SERVIR LE FRONTEND
        let filePath = path.join("frontend", url.pathname === "/" ? "index.html" : url.pathname);
        const file = Bun.file(filePath);
        if (await file.exists()) return new Response(file);

        return new Response("Not Found", { status: 404 });
    },
});

console.log(`⚡ Serveur STREAMING prêt sur http://localhost:3000`);