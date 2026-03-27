/**
 * Singer animation - draws an animated character holding a mic on a canvas.
 * The character bobs/pulses to the beat and reacts to successful taps.
 */
class SingerRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.width = canvas.width;
        this.height = canvas.height;
        this.color = '#ff2d95';
        this.beatPhase = 0;
        this.excitement = 0; // 0-1, rises on hits, decays over time
        this.mouthOpen = 0;
        this.bobOffset = 0;
    }

    setColor(hex) {
        this.color = hex;
    }

    update(currentTime, bpm, isHit) {
        if (bpm > 0) {
            const beatInterval = 60 / bpm;
            this.beatPhase = (currentTime % beatInterval) / beatInterval;
        }

        // Bob to beat
        this.bobOffset = Math.sin(this.beatPhase * Math.PI * 2) * 8;

        // Mouth opens on beats
        this.mouthOpen = Math.max(0, Math.sin(this.beatPhase * Math.PI) * 0.8);

        // Excitement
        if (isHit) {
            this.excitement = Math.min(1, this.excitement + 0.15);
        } else {
            this.excitement *= 0.97;
        }
    }

    draw() {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;
        const cx = w / 2;
        const bob = this.bobOffset;

        ctx.clearRect(0, 0, w, h);

        // Glow behind singer
        const glowIntensity = 0.1 + this.excitement * 0.3;
        const glow = ctx.createRadialGradient(cx, h * 0.4, 10, cx, h * 0.4, 80);
        glow.addColorStop(0, this.hexToRGBA(this.color, glowIntensity));
        glow.addColorStop(1, 'transparent');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, w, h);

        const baseY = h * 0.35 + bob;

        // Body (simple torso)
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.ellipse(cx, baseY + 50, 22 + this.excitement * 3, 35, 0, 0, Math.PI * 2);
        ctx.fill();

        // Head
        const headY = baseY - 5;
        ctx.fillStyle = '#f0d0a0';
        ctx.beginPath();
        ctx.arc(cx, headY, 22, 0, Math.PI * 2);
        ctx.fill();

        // Hair
        ctx.fillStyle = '#333';
        ctx.beginPath();
        ctx.arc(cx, headY - 6, 23, Math.PI, Math.PI * 2);
        ctx.fill();

        // Eyes
        ctx.fillStyle = '#222';
        const eyeHeight = this.excitement > 0.5 ? 3 : 2;
        ctx.beginPath();
        ctx.ellipse(cx - 7, headY - 2, 2.5, eyeHeight, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(cx + 7, headY - 2, 2.5, eyeHeight, 0, 0, Math.PI * 2);
        ctx.fill();

        // Eye shine
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(cx - 6, headY - 3, 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx + 8, headY - 3, 1, 0, Math.PI * 2);
        ctx.fill();

        // Mouth (opens with singing)
        ctx.fillStyle = '#c0392b';
        const mouthH = 2 + this.mouthOpen * 8;
        ctx.beginPath();
        ctx.ellipse(cx, headY + 10, 5, mouthH / 2, 0, 0, Math.PI * 2);
        ctx.fill();

        // Arm + Mic
        const armSwing = Math.sin(this.beatPhase * Math.PI * 2) * 5 * (0.5 + this.excitement * 0.5);
        const micX = cx + 30 + armSwing;
        const micY = headY + 5 + bob * 0.5;

        // Arm
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx + 18, baseY + 30);
        ctx.quadraticCurveTo(cx + 28, baseY + 10, micX, micY + 10);
        ctx.stroke();

        // Mic handle
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(micX, micY + 10);
        ctx.lineTo(micX + 2, micY - 5);
        ctx.stroke();

        // Mic head
        ctx.fillStyle = '#888';
        ctx.beginPath();
        ctx.arc(micX + 2, micY - 9, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#aaa';
        ctx.beginPath();
        ctx.arc(micX + 2, micY - 9, 4, 0, Math.PI * 2);
        ctx.fill();

        // Sound waves when excited
        if (this.excitement > 0.2) {
            ctx.strokeStyle = this.hexToRGBA(this.color, this.excitement * 0.5);
            ctx.lineWidth = 2;
            for (let i = 1; i <= 3; i++) {
                if (this.excitement > 0.2 * i) {
                    ctx.beginPath();
                    ctx.arc(micX + 2, micY - 9, 10 + i * 8, -Math.PI * 0.3, Math.PI * 0.3);
                    ctx.stroke();
                }
            }
        }

        // Other arm (resting/vibing)
        const otherSwing = -armSwing;
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(cx - 18, baseY + 30);
        ctx.quadraticCurveTo(cx - 25, baseY + 45 + otherSwing, cx - 30, baseY + 55 + otherSwing);
        ctx.stroke();

        // Hand
        ctx.fillStyle = '#f0d0a0';
        ctx.beginPath();
        ctx.arc(cx - 30, baseY + 55 + otherSwing, 5, 0, Math.PI * 2);
        ctx.fill();

        // Legs
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(cx - 8, baseY + 80);
        ctx.lineTo(cx - 12, baseY + 120 - bob * 0.3);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx + 8, baseY + 80);
        ctx.lineTo(cx + 12, baseY + 120 + bob * 0.3);
        ctx.stroke();

        // Shoes
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.ellipse(cx - 12, baseY + 122 - bob * 0.3, 8, 4, -0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(cx + 12, baseY + 122 + bob * 0.3, 8, 4, 0.2, 0, Math.PI * 2);
        ctx.fill();
    }

    hexToRGBA(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r},${g},${b},${alpha})`;
    }
}

window.SingerRenderer = SingerRenderer;
