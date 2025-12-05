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

// --- GESTION PLC (NODES7) ---
const conn = new nodes7();
let plcConnected = false;

// Fonction de connexion avec reconnexion auto
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
            // Définir la variable à écrire (DB1, Byte 0, Bit 0)
            conn.setTranslationCB((tag) => { return [tag]; });
            conn.addItems('VISION_STOP', 'DB1,X0.0'); 
        }
    });
};
connectPLC();

// Fonction d'écriture (Promisified)
const writePLC = async (stop: boolean) => {
    if (!plcConnected) return false;
    return new Promise((resolve, reject) => {
        // nodes7 écrit "true" ou "false" directement sur le bit
        conn.writeItems('VISION_STOP', stop, (err) => {
            if (err) {
                console.error("Erreur écriture PLC", err);
                plcConnected = false;
                connectPLC(); // Forcer reconnexion
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
    
    // Si fichier vide, ajouter header
    if (!fs.existsSync(filename)) {
        await Bun.write(filename, "Timestamp;Date;Heure;Etat;Pixels\n");
    }
    
    // Ajouter la ligne (Append)
    const file = Bun.file(filename);
    const content = await file.text();
    await Bun.write(filename, content + line);
};

// --- SERVEUR WEB (BUN) ---
serve({
    port: 3000,
    async fetch(req) {
        const url = new URL(req.url);
        
        // 1. LOGIN API
        if (url.pathname === "/api/login" && req.method === "POST") {
            const body = await req.json();
            if (body.username === CONFIG.USER && body.password === CONFIG.PASS) {
                const headers = new Headers();
                // Cookie valable 24h
                headers.set("Set-Cookie", `session=logged_in; Path=/; Max-Age=86400`);
                return new Response("OK", { status: 200, headers });
            }
            return new Response("Unauthorized", { status: 401 });
        }

        // 2. LOGOUT API
        if (url.pathname === "/api/logout") {
            const headers = new Headers();
            headers.set("Set-Cookie", `session=; Path=/; Max-Age=0`); // Expire tout de suite
            headers.set("Location", "/login.html");
            return new Response("Redirect", { status: 302, headers });
        }

        // --- MIDDLEWARE AUTHENTIFICATION ---
        // Pages publiques
        const publicPaths = ["/login.html", "/image_4.jpg"];
        if (!publicPaths.includes(url.pathname)) {
            const cookie = req.headers.get("Cookie") || "";
            if (!cookie.includes("session=logged_in")) {
                return Response.redirect("/login.html");
            }
        }

        // 3. API ALARM (PLC)
        if (url.pathname === "/api/alarm" && req.method === "POST") {
            const body = await req.json();
            await writePLC(body.alarm);
            if (body.alarm) console.log("🚨 ARRÊT MACHINE DEMANDÉ");
            return new Response(JSON.stringify({ status: "OK" }), { headers: { "Content-Type": "application/json" } });
        }

        // 4. API LOG (SSD)
        if (url.pathname === "/api/log" && req.method === "POST") {
            const body = await req.json();
            writeLog(body);
            return new Response("Logged", { status: 200 });
        }

        // 5. SERVIR FICHIERS STATIQUES (FRONTEND)
        let filePath = path.join("frontend", url.pathname === "/" ? "index.html" : url.pathname);
        const file = Bun.file(filePath);
        
        if (await file.exists()) {
            return new Response(file);
        }

        return new Response("Not Found", { status: 404 });
    },
});

console.log(`⚡ Serveur BUN Vision prêt sur http://localhost:3000`);