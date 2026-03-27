/**
 * Catalogue system - all artists and songs are defined here by the game owner.
 * Players NEVER upload songs - everything is curated content you own the rights to.
 *
 * Difficulty system (Guitar Hero style):
 *   - Songs do NOT have a fixed difficulty
 *   - Player picks a DIFFICULTY MODE before playing any song
 *   - 4 modes: Beginner, Easy, Medium, Hard
 *   - Each mode changes note density, lane usage, patterns, and timing strictness
 *   - Stars are tracked per song PER difficulty
 */

const DIFFICULTIES = [
    {
        id: 'beginner',
        name: 'BEGINNER',
        color: '#22c55e',
        description: 'Sparse notes. Learn the songs.',
        lanes: 5,
        noteFrequency: 0.25,
        doubleNotes: false,
        holdNotes: false,
        timingWindow: 1.5,
    },
    {
        id: 'easy',
        name: 'EASY',
        color: '#3b82f6',
        description: 'More notes start filling in.',
        lanes: 5,
        noteFrequency: 0.45,
        doubleNotes: false,
        holdNotes: false,
        timingWindow: 1.3,
    },
    {
        id: 'medium',
        name: 'MEDIUM',
        color: '#f59e0b',
        description: 'Doubles and holds appear. Stay sharp.',
        lanes: 5,
        noteFrequency: 0.7,
        doubleNotes: true,
        doubleChance: 0.15,
        holdNotes: true,
        holdChance: 0.08,
        timingWindow: 1.0,
    },
    {
        id: 'hard',
        name: 'HARD',
        color: '#ef4444',
        description: 'Relentless notes. Heavy doubles and holds.',
        lanes: 5,
        noteFrequency: 1.0,
        doubleNotes: true,
        doubleChance: 0.3,
        holdNotes: true,
        holdChance: 0.15,
        timingWindow: 0.75,
    }
];

const ARTISTS = [
    {
        id: 'downs-east',
        name: 'Downs East',
        emoji: '🦞',
        color: '#e63946',
        unlockCost: 0,
        description: '20 tracks of Downeast sound.',
    },
    {
        id: 'she-reigns',
        name: 'She Reigns',
        emoji: '👑',
        color: '#a855f7',
        unlockCost: 0,
        description: '15 tracks of fierce, fearless sound.',
    }
];

const SONGS = [
    { id: 'de-blueberries-and-beer', artistId: 'downs-east', title: 'Blueberries and Beer', bpm: 120, duration: 314, audioFile: 'songs/downs-east/Blueberries and Beer.mp3' },
    { id: 'de-deckhands-delight', artistId: 'downs-east', title: "Deckhands' Delight", bpm: 130, duration: 220, audioFile: "songs/downs-east/Deckhands' Delight.mp3" },
    { id: 'de-downeast-trap', artistId: 'downs-east', title: 'Downeast Trap', bpm: 128, duration: 227, audioFile: 'songs/downs-east/Downeast Trap.mp3' },
    { id: 'de-drown-a-whale', artistId: 'downs-east', title: 'Drown a Whale (Up to Camp)', bpm: 115, duration: 251, audioFile: 'songs/downs-east/Drown a Whale (Up to Camp).mp3' },
    { id: 'de-ellsworth-appetite', artistId: 'downs-east', title: 'Ellsworth Appetite', bpm: 122, duration: 254, audioFile: 'songs/downs-east/Ellsworth Appetite.mp3' },
    { id: 'de-feral-downeast-tablet-kids', artistId: 'downs-east', title: 'Feral Downeast Tablet Kids', bpm: 135, duration: 217, audioFile: 'songs/downs-east/Feral Downeast Tablet Kids.mp3' },
    { id: 'de-ghosts-of-route-1', artistId: 'downs-east', title: 'Ghosts of Route 1', bpm: 108, duration: 339, audioFile: 'songs/downs-east/Ghosts of Route 1.mp3' },
    { id: 'de-jaspers-beach', artistId: 'downs-east', title: "Jasper's Beach", bpm: 118, duration: 264, audioFile: "songs/downs-east/Jasper's Beach.mp3" },
    { id: 'de-lobstah-life', artistId: 'downs-east', title: 'Lobstah Life', bpm: 125, duration: 250, audioFile: 'songs/downs-east/Lobstah Life.mp3' },
    { id: 'de-lobster-pots-and-minivans', artistId: 'downs-east', title: 'Lobster Pots and Minivans', bpm: 120, duration: 239, audioFile: 'songs/downs-east/Lobster Pots and Minivans Mastered full.mp3' },
    { id: 'de-new-paint-on-the-old-pier', artistId: 'downs-east', title: 'New Paint on the Old Pier', bpm: 110, duration: 276, audioFile: 'songs/downs-east/New Paint on the Old Pier.mp3' },
    { id: 'de-safe-from-the-storm', artistId: 'downs-east', title: 'Safe From the Storm', bpm: 116, duration: 237, audioFile: 'songs/downs-east/Safe From the Storm.mp3' },
    { id: 'de-the-dispatch-static', artistId: 'downs-east', title: 'The Dispatch Static', bpm: 140, duration: 194, audioFile: 'songs/downs-east/The Dispatch Static (Edit).mp3' },
    { id: 'de-the-factory-ride', artistId: 'downs-east', title: 'The Factory Ride', bpm: 126, duration: 269, audioFile: 'songs/downs-east/The Factory Ride.mp3' },
    { id: 'de-the-fifth-season-ft', artistId: 'downs-east', title: 'The Fifth Season (ft Florida Pete)', bpm: 118, duration: 175, audioFile: 'songs/downs-east/The Fifth Season (ft Florida Pete).mp3' },
    { id: 'de-the-fifth-season', artistId: 'downs-east', title: 'The Fifth Season', bpm: 118, duration: 208, audioFile: 'songs/downs-east/The Fifth Season.mp3' },
    { id: 'de-inspection-sticker-blues', artistId: 'downs-east', title: 'The Inspection Sticker Blues', bpm: 132, duration: 177, audioFile: 'songs/downs-east/The Inspection Sticker Blues (Edit).mp3' },
    { id: 'de-kingdom-of-lobster-pots', artistId: 'downs-east', title: 'The Kingdom of Lobster Pots & Minivans', bpm: 120, duration: 250, audioFile: 'songs/downs-east/the Kingdom of Lobster Pots & Minivans (Edit).mp3' },
    { id: 'de-the-old-woodshed', artistId: 'downs-east', title: 'The Old Woodshed', bpm: 105, duration: 323, audioFile: 'songs/downs-east/The Old Woodshed (Edit).mp3' },
    { id: 'de-when-the-woods-come-to-town', artistId: 'downs-east', title: 'When the Woods Come to Town', bpm: 114, duration: 264, audioFile: 'songs/downs-east/When the Woods Come to Town.mp3' },
    // She Reigns
    { id: 'sr-bless-your-heart', artistId: 'she-reigns', title: 'Bless Your Heart', bpm: 120, duration: 240, audioFile: 'songs/she-reigns/Bless Your Heart.mp3' },
    { id: 'sr-closet-riot', artistId: 'she-reigns', title: 'Closet Riot', bpm: 128, duration: 230, audioFile: 'songs/she-reigns/Closet Riot v2.mp3' },
    { id: 'sr-empire-of-strings', artistId: 'she-reigns', title: 'Empire of Strings', bpm: 110, duration: 255, audioFile: 'songs/she-reigns/Empire of Strings v2.mp3' },
    { id: 'sr-ghost-in-my-heart', artistId: 'she-reigns', title: 'Ghost In My Heart', bpm: 115, duration: 245, audioFile: 'songs/she-reigns/Ghost In My Heart.mp3' },
    { id: 'sr-lines-in-the-water', artistId: 'she-reigns', title: 'Lines in the Water', bpm: 108, duration: 260, audioFile: 'songs/she-reigns/Lines in the Water.mp3' },
    { id: 'sr-no-more-silence', artistId: 'she-reigns', title: 'No More Silence', bpm: 132, duration: 220, audioFile: 'songs/she-reigns/No More Silence v2.mp3' },
    { id: 'sr-no-room-in-my-womb', artistId: 'she-reigns', title: 'No Room in My Womb', bpm: 122, duration: 235, audioFile: 'songs/she-reigns/No Room in My Womb v2.mp3' },
    { id: 'sr-power-in-my-hands', artistId: 'she-reigns', title: 'Power in My Hands', bpm: 130, duration: 225, audioFile: 'songs/she-reigns/Power in My Hands v2.mp3' },
    { id: 'sr-pretend-america', artistId: 'she-reigns', title: 'Pretend America', bpm: 118, duration: 250, audioFile: 'songs/she-reigns/Pretend America v2.mp3' },
    { id: 'sr-pretty-when-youre-quiet', artistId: 'she-reigns', title: "Pretty When You're Quiet", bpm: 105, duration: 270, audioFile: "songs/she-reigns/Pretty When You're Quiet.mp3" },
    { id: 'sr-receipt-season', artistId: 'she-reigns', title: 'Receipt Season', bpm: 126, duration: 230, audioFile: 'songs/she-reigns/Receipt Season.mp3' },
    { id: 'sr-safe-with-you', artistId: 'she-reigns', title: 'Safe With You', bpm: 112, duration: 260, audioFile: 'songs/she-reigns/Safe With You.mp3' },
    { id: 'sr-state-property', artistId: 'she-reigns', title: 'State Property', bpm: 136, duration: 215, audioFile: 'songs/she-reigns/State Property v2.mp3' },
    { id: 'sr-we-burn-we-rise', artistId: 'she-reigns', title: 'We Burn, We Rise', bpm: 124, duration: 240, audioFile: 'songs/she-reigns/We Burn, We Rise v2.mp3' },
    { id: 'sr-work-sleep-repeat', artistId: 'she-reigns', title: 'Work, Sleep, Repeat', bpm: 140, duration: 210, audioFile: 'songs/she-reigns/Work, Sleep, Repeat.mp3' },
];


class CatalogueManager {
    constructor() {
        this.artists = ARTISTS;
        this.songs = SONGS;
        this.difficulties = DIFFICULTIES;
        this.saveKey = 'recordtap_save_v2';
        this.playerData = this.loadProgress();
    }

    loadProgress() {
        try {
            const raw = localStorage.getItem(this.saveKey);
            if (raw) {
                const data = JSON.parse(raw);
                if (!data.unlockedArtists.includes('downs-east')) {
                    data.unlockedArtists.push('downs-east');
                }
                if (!data.unlockedArtists.includes('she-reigns')) {
                    data.unlockedArtists.push('she-reigns');
                }
                return data;
            }
        } catch (e) { /* corrupt save, reset */ }

        return {
            stars: 0,
            totalStarsEarned: 0,
            unlockedArtists: ['downs-east', 'she-reigns'],
            songBests: {} // { "songId:diffId": { score, stars, grade } }
        };
    }

    saveProgress() {
        localStorage.setItem(this.saveKey, JSON.stringify(this.playerData));
    }

    resetProgress() {
        localStorage.removeItem(this.saveKey);
        this.playerData = this.loadProgress();
    }

    getTotalStars() {
        return this.playerData.stars;
    }

    getTotalSongsUnlocked() {
        let count = 0;
        for (const artist of this.artists) {
            if (this.isArtistUnlocked(artist.id)) {
                count += this.getSongsForArtist(artist.id).length;
            }
        }
        return count;
    }

    isArtistUnlocked(artistId) {
        return this.playerData.unlockedArtists.includes(artistId);
    }

    canUnlockArtist(artistId) {
        const artist = this.getArtist(artistId);
        if (!artist) return false;
        return this.playerData.stars >= artist.unlockCost && !this.isArtistUnlocked(artistId);
    }

    unlockArtist(artistId) {
        const artist = this.getArtist(artistId);
        if (!artist || this.isArtistUnlocked(artistId)) return false;
        if (this.playerData.stars < artist.unlockCost) return false;

        this.playerData.stars -= artist.unlockCost;
        this.playerData.unlockedArtists.push(artistId);
        this.saveProgress();
        return true;
    }

    getArtist(artistId) {
        return this.artists.find(a => a.id === artistId) || null;
    }

    getSongsForArtist(artistId) {
        return this.songs.filter(s => s.artistId === artistId);
    }

    getSong(songId) {
        return this.songs.find(s => s.id === songId) || null;
    }

    getSongBest(songId, diffId) {
        const key = diffId ? `${songId}:${diffId}` : songId;
        return this.playerData.songBests[key] || null;
    }

    getDifficulty(diffId) {
        return this.difficulties.find(d => d.id === diffId) || null;
    }

    getSongStarsForDifficulty(songId, diffId) {
        const best = this.getSongBest(songId, diffId);
        return best ? best.stars : 0;
    }

    /**
     * Record a song result. Returns the number of NEW stars earned.
     */
    recordResult(songId, diffId, score, stars, grade) {
        const key = `${songId}:${diffId}`;
        const prev = this.playerData.songBests[key];
        const prevStars = prev ? prev.stars : 0;

        if (!prev || score > prev.score) {
            this.playerData.songBests[key] = { score, stars, grade };
        } else if (stars > prev.stars) {
            this.playerData.songBests[key].stars = stars;
            this.playerData.songBests[key].grade = grade;
        }

        const newStars = Math.max(0, stars - prevStars);
        this.playerData.stars += newStars;
        this.playerData.totalStarsEarned += newStars;
        this.saveProgress();
        return newStars;
    }
}

window.CatalogueManager = CatalogueManager;
window.ARTISTS = ARTISTS;
window.SONGS = SONGS;
window.DIFFICULTIES = DIFFICULTIES;
