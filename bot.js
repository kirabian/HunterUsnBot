require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const token = process.env.BOT_TOKEN;
const channelUsername = process.env.CHANNEL_USERNAME;
const adminId = process.env.ADMIN_ID || '6353435315';

if (!token) {
    console.error('BOT_TOKEN tidak ditemukan di .env');
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
console.log('Bot sedang berjalan...');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ================= CONFIG & DATABASE USERS =================
const LIMIT_CARI = 20;
const LIMIT_BULK = 3;

const dbPath = path.join(__dirname, 'users.json');
let users = {};
const activeBulkUsers = new Set();

// API Fetch Harga TON
async function getTonPrice() {
    try {
        const res = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=idr,usd');
        return res.data['the-open-network']; // { idr: 123, usd: 5.5 }
    } catch (e) {
        return null;
    }
}

if (fs.existsSync(dbPath)) {
    try {
        const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        // Jika format lama (array), migrasikan ke format object
        if (Array.isArray(data)) {
            data.forEach(id => {
                users[id] = { cariCount: 0, bulkCount: 0, lastHour: new Date().getHours(), bonusBulk: 0, referredBy: null };
            });
            fs.writeFileSync(dbPath, JSON.stringify(users, null, 2));
        } else {
            users = data;
            // Pastikan properti baru ada
            for (let id in users) {
                if (users[id].bonusBulk === undefined) users[id].bonusBulk = 0;
                if (users[id].referredBy === undefined) users[id].referredBy = null;
            }
        }
    } catch (e) {
        users = {};
    }
}

function saveUser(userId, referrerId = null) {
    const currentHour = new Date().getHours();
    
    if (!users[userId]) {
        users[userId] = { 
            cariCount: 0, 
            bulkCount: 0, 
            lastHour: currentHour, 
            bonusBulk: 0, 
            referredBy: referrerId 
        };
        fs.writeFileSync(dbPath, JSON.stringify(users, null, 2));
        
        // Logika Referral: Jika ada referrer yang valid, beri dia bonus
        if (referrerId && users[referrerId] && String(referrerId) !== String(userId)) {
            users[referrerId].bonusBulk += 2;
            fs.writeFileSync(dbPath, JSON.stringify(users, null, 2));
            bot.sendMessage(referrerId, `🎉 <b>Selamat!</b>\nSatu teman baru saja menggunakan bot ini melalui link referral Anda.\n\nAnda mendapatkan <b>+2 kuota /bulk gratis</b> (berlaku permanen sampai digunakan)!`, { parse_mode: 'HTML' }).catch(()=>{});
        }
    } else {
        // Reset limit jika jam sudah berbeda
        if (users[userId].lastHour !== currentHour) {
            users[userId].cariCount = 0;
            users[userId].bulkCount = 0;
            users[userId].lastHour = currentHour;
            fs.writeFileSync(dbPath, JSON.stringify(users, null, 2));
        }
    }
}

function checkLimit(userId, type) {
    // Admin bypass limit
    if (userId.toString() === adminId) return true;

    saveUser(userId);
    const user = users[userId];
    
    if (type === 'cari') {
        if (user.cariCount >= LIMIT_CARI) return false;
        user.cariCount++;
    } else if (type === 'bulk') {
        if (user.bulkCount >= LIMIT_BULK) {
            // Cek apakah punya bonus kuota referral
            if (user.bonusBulk && user.bonusBulk > 0) {
                user.bonusBulk--;
                fs.writeFileSync(dbPath, JSON.stringify(users, null, 2));
                return true;
            }
            return false;
        }
        user.bulkCount++;
    }
    
    fs.writeFileSync(dbPath, JSON.stringify(users, null, 2));
    return true;
}
// ================= FORCE SUBSCRIBE =================
async function isSubscribed(chatId, userId) {
    saveUser(userId); // Selalu simpan user setiap kali berinteraksi
    
    if (!channelUsername || channelUsername.trim() === '' || channelUsername === '@username_channel_anda') {
        return true; // Lewati jika channel belum di-set
    }

    try {
        const chatMember = await bot.getChatMember(channelUsername, userId);
        if (chatMember.status === 'left' || chatMember.status === 'kicked') {
            const warnText = `⚠️ <b>Akses Ditolak</b>\n\nUntuk menggunakan Bot ini, Anda <b>WAJIB</b> bergabung ke channel kami terlebih dahulu!\n\nSilakan bergabung di sini: ${channelUsername}\nSetelah bergabung, coba ketik perintah Anda lagi.`;
            bot.sendMessage(chatId, warnText, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[{ text: '📢 Gabung Channel', url: `https://t.me/${channelUsername.replace('@', '')}` }]]
                }
            });
            return false;
        }
        return true;
    } catch (error) {
        console.error(`Gagal cek subs: ${error.message}`);
        // Jika bot bukan admin di channel, getChatMember akan gagal.
        const warnText = `⚠️ <b>Sistem Cek Subs Error</b>\n\nBot tidak bisa mengecek status keanggotaan Anda karena Bot belum dijadikan <b>Admin</b> di channel ${channelUsername}!\n\n<i>Harap jadikan bot sebagai admin di channel tersebut agar fitur ini berfungsi.</i>`;
        bot.sendMessage(chatId, warnText, { parse_mode: 'HTML' });
        return false; 
    }
}

// ================= FRAGMENT CHECKER =================
async function checkFragment(username) {
    try {
        const response = await axios.get(`https://fragment.com/username/${username}`);
        const $ = cheerio.load(response.data);
        const rawStatus = $('.tm-section-header-status').text().trim();

        if (!rawStatus) {
            return 'Unknown on Fragment';
        }

        const normalized = rawStatus.toLowerCase();
        if (normalized.includes('not on fragment')) {
            return 'Not on Fragment';
        }
        if (normalized.includes('available')) {
            return 'Available';
        }
        return rawStatus;
    } catch (error) {
        if (error.response && error.response.status === 404) {
            return 'Not on Fragment';
        }
        return 'Error checking Fragment';
    }
}

function isFragmentLikelyTaken(fragmentStatus) {
    return fragmentStatus !== 'Not on Fragment' &&
           fragmentStatus !== 'Available' &&
           fragmentStatus !== 'Unknown on Fragment' &&
           fragmentStatus !== 'Error checking Fragment';
}

// ================= COMMANDS =================

// Fitur Start
bot.onText(/^\/start(?: (.+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Cek apakah user sudah subscribe
    if (!(await isSubscribed(chatId, userId))) return;
    
    // Logika Referral
    let referrerId = null;
    const startParam = match[1];
    if (startParam && startParam.startsWith('ref_')) {
        referrerId = startParam.split('_')[1];
    }
    
    saveUser(userId, referrerId);
    
    const botUsername = (await bot.getMe()).username;
    
    const welcomeText = `👋 <b>Selamat datang di Bot Hunter USN Telegram!</b>\n\n` +
        `Bot pintar ini dibuat khusus untuk mempermudah Anda berburu username langka, unik, dan estetis secara massal dan otomatis.\n\n` +
        `🔥 <b>Keunggulan Bot Kami:</b>\n` +
        `✨ Scan ratusan hingga ribuan username dalam sekejap\n` +
        `✨ Kesempatan emas mengamankan username idaman lebih cepat\n` +
        `✨ Deteksi akurat antara username murni vs username Fragment/Web3\n` +
        `✨ 100% GRATIS didedikasikan untuk para kolektor username!\n\n` +
        `<b>Mulai berburu sekarang dengan perintah berikut:</b>\n` +
        `🔍 /cari @username - Cek satu username\n` +
        `🚀 /bulk - Cek ratusan/ribuan username\n` +
        `🆔 /id - Cek ID Telegram Anda\n` +
        `🏓 /ping - Cek status bot\n` +
        `❓ /help - Panduan lengkap\n\n` +
        `🎁 <b>Dapatkan +2 Kuota Bulk Tambahan GRATIS!</b>\n` +
        `Bagikan link referral Anda ke teman. Jika mereka menggunakan bot melalui link Anda, Anda berdua diuntungkan!\n` +
        `👉 <code>https://t.me/${botUsername}?start=ref_${userId}</code>`;
        
    bot.sendMessage(chatId, welcomeText, { 
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [[{ text: '👨‍💻 Bantuan & Panduan', callback_data: 'help_btn' }]]
        }
    });
});

// Fitur Help
const helpHandler = async (chatId, userId) => {
    const botUsername = (await bot.getMe()).username;
    const helpText = `🛠 <b>Pusat Bantuan Bot Hunter USN</b>\n\n` +
        `<b>Cara Cek Satu Username:</b>\n` +
        `Ketik /cari nama_usn atau /cari @nama_usn\n\n` +
        `<b>Cara Cek Massal (Ratusan/Ribuan):</b>\n` +
        `1. Langsung ketik daftar username di chat ini (boleh pakai koma, spasi, atau enter).\n` +
        `2. <b>ATAU</b> Kirimkan file .txt berisi daftar username ke bot ini.\n\n` +
        `<b>🎁 Dapatkan Kuota Gratis (Referral)</b>\n` +
        `Ajak teman Anda menggunakan bot ini via link di bawah, dan Anda akan mendapat tambahan +2 kuota Bulk!\n` +
        `👉 <code>https://t.me/${botUsername}?start=ref_${userId}</code>`;
    bot.sendMessage(chatId, helpText, { parse_mode: 'HTML' });
};

bot.onText(/^\/help$/, (msg) => helpHandler(msg.chat.id, msg.from.id));
bot.on('callback_query', (query) => {
    if (query.data === 'help_btn') {
        helpHandler(query.message.chat.id, query.from.id);
        bot.answerCallbackQuery(query.id);
    }
});

// Fitur Cek ID & Ping
bot.onText(/^\/id$/, (msg) => {
    bot.sendMessage(msg.chat.id, `🆔 ID Telegram Anda adalah: <code>${msg.from.id}</code>`, { parse_mode: 'HTML' });
});

bot.onText(/^\/ping$/, (msg) => {
    const startTime = Date.now();
    bot.sendMessage(msg.chat.id, '🏓 Pong!').then(sentMsg => {
        const latency = Date.now() - startTime;
        bot.editMessageText(`🏓 <b>Pong!</b>\nLatency: ${latency}ms`, {
            chat_id: msg.chat.id,
            message_id: sentMsg.message_id,
            parse_mode: 'HTML'
        });
    });
});

// Fitur Admin: Stats
bot.onText(/^\/stats$/, async (msg) => {
    const chatId = msg.chat.id;
    if (String(msg.from.id) !== String(adminId)) return;
    
    bot.sendMessage(chatId, `⏳ Mengambil data statistik dan harga pasar...`);
    
    const totalUsers = Object.keys(users).length;
    let totalCariToday = 0;
    let totalBulkToday = 0;
    let totalBonusBulk = 0;
    
    const currentHour = new Date().getHours();
    
    for (const key in users) {
        if (users[key].lastHour === currentHour) {
            totalCariToday += users[key].cariCount;
            totalBulkToday += users[key].bulkCount;
        }
        totalBonusBulk += users[key].bonusBulk || 0;
    }
    
    const tonData = await getTonPrice();
    const tonText = tonData ? `Rp ${tonData.idr.toLocaleString('id-ID')} / $${tonData.usd}` : `Gagal mengambil data`;
    
    const statsText = `📊 <b>Statistik Bot</b>\n\n` +
                      `👥 Total Pengguna: <b>${totalUsers}</b> user\n` +
                      `🎁 Total Bonus Bulk Tersimpan: <b>${totalBonusBulk}</b>\n\n` +
                      `📈 <b>Aktivitas Jam Ini:</b>\n` +
                      `🔍 Pencarian Tunggal: ${totalCariToday} kali\n` +
                      `📦 Pencarian Massal (Bulk): ${totalBulkToday} kali\n\n` +
                      `🌐 <b>Kurs TON saat ini:</b> ${tonText}`;
                      
    bot.sendMessage(chatId, statsText, { parse_mode: 'HTML' });
});

// Fitur Admin: Broadcast
bot.onText(/^\/broadcast ([\s\S]+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (String(msg.from.id) !== String(adminId)) return;
    
    const message = match[1];
    const userIds = Object.keys(users); // Ambil semua ID user dari object
    
    bot.sendMessage(chatId, `Mulai mengirim broadcast ke ${userIds.length} user...`);
    
    let success = 0;
    for (const u of userIds) {
        try {
            await bot.sendMessage(u, `📢 <b>PENGUMUMAN</b>\n\n${message}`, { parse_mode: 'HTML' });
            success++;
            await delay(300); // Hindari limit broadcast
        } catch (e) {
            // Abaikan jika user memblokir bot
        }
    }
    
    bot.sendMessage(chatId, `✅ Broadcast selesai!\nTerkirim ke: ${success}/${userIds.length} user.`);
});

// Fitur Cari 1 Username
bot.onText(/^\/cari (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (!(await isSubscribed(chatId, msg.from.id))) return;

    if (!checkLimit(msg.from.id, 'cari')) {
        return bot.sendMessage(chatId, `⚠️ <b>Limit Tercapai!</b>\nAnda sudah mencapai batas maksimum pengecekan tunggal per jam (${LIMIT_CARI}x).\n\nSilakan tunggu hingga jam berikutnya atau pertimbangkan fitur Premium di masa mendatang!`, { parse_mode: 'HTML' });
    }

    let username = match[1].trim().replace('@', '');
    if (!username) return;

    bot.sendMessage(chatId, `🔍 Mengecek ketersediaan @${username}...`);
    const fragmentStatus = await checkFragment(username);

    if (isFragmentLikelyTaken(fragmentStatus)) {
        const reply = `❌ Username @${username} <b>TIDAK BISA DIPAKAI BEBAS</b>.\n💎 Status Fragment: <b>${fragmentStatus}</b>`;
        return bot.sendMessage(chatId, reply, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '📱 Buka di Telegram', url: `https://t.me/${username}` },
                        { text: '💎 Cek di Fragment', url: `https://fragment.com/username/${username}` }
                    ]
                ]
            }
        });
    }

    try {
        await bot.getChat(`@${username}`);
        let reply = `❌ Username @${username} <b>TIDAK BISA DIPAKAI BEBAS</b>.`;
        if (fragmentStatus !== 'Not on Fragment' && fragmentStatus !== 'Error checking Fragment') {
            reply += `\n💎 Tapi username ini ada di Fragment dengan status: <b>${fragmentStatus}</b>`;
        }

        bot.sendMessage(chatId, reply, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '📱 Buka di Telegram', url: `https://t.me/${username}` },
                        { text: '💎 Cek di Fragment', url: `https://fragment.com/username/${username}` }
                    ]
                ]
            }
        });

    } catch (error) {
        if (error.response && error.response.statusCode === 400) {
            const reply = `✅ Username @${username} <b>MURNI TERSEDIA</b> (Bisa diklaim)!`;
            bot.sendMessage(chatId, reply, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '📱 Buka di Telegram', url: `https://t.me/${username}` },
                            { text: '💎 Cek di Fragment', url: `https://fragment.com/username/${username}` }
                        ]
                    ]
                }
            });
        } else if (error.response && error.response.statusCode === 429) {
            const retryAfter = error.response.body.parameters.retry_after || 10;
            bot.sendMessage(chatId, `⚠️ Bot sedang terkena limit! Coba lagi dalam ${retryAfter} detik.`);
        } else {
            bot.sendMessage(chatId, `⚠️ Terjadi kesalahan saat mengecek @${username}.`);
        }
    }
});

// Fitur Bulk / Panduan
bot.onText(/^\/bulk(?:\s+(.+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (!(await isSubscribed(chatId, userId))) return;
    
    const text = match[1];
    
    // Jika hanya mengetik /bulk tanpa text tambahan, panggil help handler
    if (!text) {
        return helpHandler(chatId);
    }

    if (activeBulkUsers.has(userId)) {
        return bot.sendMessage(chatId, '⚠️ Anda masih memiliki proses bulk yang sedang berjalan. Harap tunggu hingga selesai.');
    }

    if (!checkLimit(userId, 'bulk')) {
        return bot.sendMessage(chatId, `⚠️ <b>Limit Tercapai!</b>\nAnda sudah mencapai batas maksimum bulk per jam (${LIMIT_BULK}x).\n\nSilakan tunggu hingga jam berikutnya.`, { parse_mode: 'HTML' });
    }

    // Jika ada text tambahan, proses username-nya
    const usernames = text.split(/[\n, ]+/) // Pisahkan berdasarkan baris baru, koma, atau spasi
        .map(u => u.trim().replace(/@/g, '')) // Hapus spasi dan @
        .filter(u => u.length > 0);

    if (usernames.length === 0) {
        return bot.sendMessage(chatId, 'Username tidak valid. Pisahkan dengan koma atau spasi.');
    }

    activeBulkUsers.add(userId);
    const progressMsg = await bot.sendMessage(chatId, `🚀 Ditemukan ${usernames.length} username. Mulai mengecek...\n⏳ Progress: 0 / ${usernames.length} (0%)`, { parse_mode: 'HTML' });
    
    try {
        await processUsernames(chatId, usernames, progressMsg.message_id);
    } finally {
        activeBulkUsers.delete(userId);
    }
});

// Handler File TXT untuk Bulk
bot.on('document', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (!(await isSubscribed(chatId, userId))) return;
    
    if (!msg.document.file_name.endsWith('.txt')) {
        return;
    }

    if (activeBulkUsers.has(userId)) {
        return bot.sendMessage(chatId, '⚠️ Anda masih memiliki proses bulk yang sedang berjalan. Harap tunggu hingga selesai.');
    }

    if (!checkLimit(userId, 'bulk')) {
        return bot.sendMessage(chatId, `⚠️ <b>Limit Tercapai!</b>\nAnda sudah mencapai batas maksimum bulk per jam (${LIMIT_BULK}x).\n\nSilakan tunggu hingga jam berikutnya.`, { parse_mode: 'HTML' });
    }

    bot.sendMessage(chatId, '📥 Mendownload file dan memulai pengecekan otomatis...');

    try {
        const fileLink = await bot.getFileLink(msg.document.file_id);
        const response = await axios.get(fileLink);
        
        const text = response.data;
        const usernames = text.split('\n')
            .map(u => u.trim().replace(/@/g, '').replace(/,/g, '').replace(/ /g, ''))
            .filter(u => u.length > 0);

        if (usernames.length === 0) {
            return bot.sendMessage(chatId, 'File kosong atau tidak ada username yang valid.');
        }

        activeBulkUsers.add(userId);
        const progressMsg = await bot.sendMessage(chatId, `🚀 Ditemukan ${usernames.length} username. Mulai mengecek...\n⏳ Progress: 0 / ${usernames.length} (0%)`, { parse_mode: 'HTML' });
        
        await processUsernames(chatId, usernames, progressMsg.message_id);
    } catch (error) {
        bot.sendMessage(chatId, `⚠️ Gagal memproses file: ${error.message}`);
    } finally {
        activeBulkUsers.delete(userId);
    }
});

// Handler Teks Biasa untuk Bulk (jika bukan command)
bot.on('text', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;

    // Abaikan semua command yang diawali /
    if (text.startsWith('/')) return;
    
    if (!(await isSubscribed(chatId, userId))) return;

    // Memecah berdasarkan baris, koma, atau spasi
    const usernames = text.split(/[\n, ]+/)
        .map(u => u.trim().replace(/@/g, ''))
        .filter(u => u.length > 0);

    if (usernames.length === 0) return;

    if (activeBulkUsers.has(userId)) {
        return bot.sendMessage(chatId, '⚠️ Anda masih memiliki proses bulk yang sedang berjalan. Harap tunggu hingga selesai.');
    }

    if (!checkLimit(userId, 'bulk')) {
        return bot.sendMessage(chatId, `⚠️ <b>Limit Tercapai!</b>\nAnda sudah mencapai batas maksimum bulk per jam (${LIMIT_BULK}x).\n\nSilakan tunggu hingga jam berikutnya.`, { parse_mode: 'HTML' });
    }

    activeBulkUsers.add(userId);
    const progressMsg = await bot.sendMessage(chatId, `🚀 Ditemukan ${usernames.length} username. Mulai mengecek...\n⏳ Progress: 0 / ${usernames.length} (0%)`, { parse_mode: 'HTML' });
    
    try {
        await processUsernames(chatId, usernames, progressMsg.message_id);
    } finally {
        activeBulkUsers.delete(userId);
    }
});

// Fungsi inti untuk mengecek banyak username (Bulk)
async function processUsernames(chatId, usernames, progressMessageId) {
    let availableCount = 0;
    const availableList = [];
    const fragmentList = [];

    for (let i = 0; i < usernames.length; i++) {
        const username = usernames[i];
        const fragmentStatus = await checkFragment(username);

        if (isFragmentLikelyTaken(fragmentStatus)) {
            fragmentList.push(`@${username} - ${fragmentStatus}`);
        } else {
            try {
                await bot.getChat(`@${username}`);
                fragmentList.push(`@${username} - Terdaftar di Telegram${fragmentStatus === 'Available' ? `, Fragment status: ${fragmentStatus}` : ''}`);
            } catch (error) {
                if (error.response && error.response.statusCode === 400) {
                    availableList.push(`@${username} - ✅ MURNI AVAILABLE (Bisa diklaim)`);
                    availableCount++;
                } else if (error.response && error.response.statusCode === 429) {
                    const retryAfter = error.response.body?.parameters?.retry_after || 10;
                    bot.sendMessage(chatId, `⚠️ Terkena limit Telegram API! Menunggu ${retryAfter} detik sebelum melanjutkan...`);
                    await delay(retryAfter * 1000);
                    i--; // Ulangi username ini
                    continue;
                } else {
                    fragmentList.push(`@${username} - Error saat cek Telegram`);
                }
            }
        }

        // Update Progress Bar setiap 5 username atau jika mencapai username terakhir
        if (progressMessageId && ((i + 1) % 5 === 0 || i === usernames.length - 1)) {
            const percentage = Math.round(((i + 1) / usernames.length) * 100);
            
            // Opsional: Bikin visual bar biar kelihatan makin pro
            const totalBars = 10;
            const filledBars = Math.round((percentage / 100) * totalBars);
            const progressBar = '█'.repeat(filledBars) + '░'.repeat(totalBars - filledBars);

            try {
                await bot.editMessageText(
                    `🚀 Ditemukan ${usernames.length} username. Mengecek...\n` +
                    `⏳ Progress: [<code>${progressBar}</code>] <b>${i + 1} / ${usernames.length}</b> (${percentage}%)\n` +
                    `🔥 Available sementara: <b>${availableCount}</b>`, 
                    {
                        chat_id: chatId,
                        message_id: progressMessageId,
                        parse_mode: 'HTML'
                    }
                );
            } catch (e) {
                // Abaikan error "message is not modified"
            }
        }

        // Delay 1.5 detik untuk menjaga rate limit Telegram
        await delay(1500);
    }

    if (progressMessageId) {
        await bot.deleteMessage(chatId, progressMessageId).catch(() => {});
    }

    // Laporan Akhir
    let reportContent = `=== HASIL PENGECEKAN USERNAME ===\n`;
    reportContent += `Total dicek: ${usernames.length}\n`;
    reportContent += `Total Available: ${availableCount}\n\n`;

    reportContent += `--- ✅ MURNI AVAILABLE (BISA DIKLAIM) ---\n`;
    if (availableList.length > 0) {
        reportContent += availableList.join('\n') + '\n\n';
    } else {
        reportContent += `(Tidak ada username yang murni available)\n\n`;
    }

    reportContent += `--- 💎 TAKEN ATAU MASUK FRAGMENT ---\n`;
    if (fragmentList.length > 0) {
        reportContent += fragmentList.join('\n') + '\n';
    } else {
        reportContent += `(Tidak ada username yang taken)\n`;
    }

    const tonData = await getTonPrice();
    const tonPriceText = tonData ? `\n\n🌐 <b>Kurs TON saat ini:</b> Rp ${tonData.idr.toLocaleString('id-ID')} / $${tonData.usd}` : '';

    const caption = `🎉 <b>Proses Selesai!</b>\nDari total ${usernames.length} username, berhasil disaring <b>${availableCount} username</b> yang murni tersedia.\n\n✨ <i>Semoga dapet username idamanmu ya!</i>${tonPriceText}`;

    // Jika pesan kurang dari 4000 karakter, kirim sebagai teks biasa
    if (reportContent.length < 4000) {
        await bot.sendMessage(chatId, `${caption}\n\n<pre>${reportContent}</pre>`, { parse_mode: 'HTML' });
    } else {
        // Jika terlalu panjang, kita tetap kirim file txt sebagai backup, 
        // tapi kita juga kirimkan teks summary (atau hanya list yang available saja di chat)
        const availableText = availableList.join('\n');
        if (availableText.length > 0 && availableText.length < 4000) {
            await bot.sendMessage(chatId, `${caption}\n\n<b>Berikut yang AVAILABLE:</b>\n<pre>${availableText}</pre>`, { parse_mode: 'HTML' });
        } else {
            await bot.sendMessage(chatId, caption, { parse_mode: 'HTML' });
        }
        
        // Kirim file txt sebagai pelengkap jika data sangat besar
        const reportPath = path.join(__dirname, `report_${chatId}_${Date.now()}.txt`);
        fs.writeFileSync(reportPath, reportContent);
        await bot.sendDocument(chatId, reportPath, { caption: 'Hasil lengkap (karena teks terlalu panjang)' });
        fs.unlinkSync(reportPath);
    }
}
