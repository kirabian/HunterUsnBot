require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const token = process.env.BOT_TOKEN;
const channelUsername = process.env.CHANNEL_USERNAME;
const adminId = process.env.ADMIN_ID;

if (!token) {
    console.error('BOT_TOKEN tidak ditemukan di .env');
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
console.log('Bot sedang berjalan...');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ================= DATABASE USERS =================
const dbPath = path.join(__dirname, 'users.json');
let users = [];

if (fs.existsSync(dbPath)) {
    try {
        users = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    } catch (e) {
        users = [];
    }
}

function saveUser(userId) {
    if (!users.includes(userId)) {
        users.push(userId);
        fs.writeFileSync(dbPath, JSON.stringify(users, null, 2));
    }
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
bot.onText(/^\/start$/, async (msg) => {
    const chatId = msg.chat.id;
    
    // Cek apakah user sudah subscribe
    if (!(await isSubscribed(chatId, msg.from.id))) return;
    
    saveUser(msg.from.id);
    
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
        `❓ /help - Panduan lengkap`;
        
    bot.sendMessage(chatId, welcomeText, { 
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [[{ text: '👨‍💻 Bantuan & Panduan', callback_data: 'help_btn' }]]
        }
    });
});

// Fitur Help
const helpHandler = (chatId) => {
    const helpText = `🛠 <b>Pusat Bantuan Bot Hunter USN</b>\n\n` +
        `<b>Cara Cek Satu Username:</b>\n` +
        `Ketik /cari nama_usn atau /cari @nama_usn\n\n` +
        `<b>Cara Cek Massal (Ratusan/Ribuan):</b>\n` +
        `1. Langsung ketik daftar username di chat ini (boleh pakai koma, spasi, atau enter. Pakai @ atau tidak, bebas).\n` +
        `2. <b>ATAU</b> Kirimkan file .txt berisi daftar username ke bot ini.\n\n` +
        `<i>Bot akan otomatis menyeleksi mana yang murni bisa diklaim, dan mana yang berstatus Premium/Dijual di Fragment.</i>`;
    bot.sendMessage(chatId, helpText, { parse_mode: 'HTML' });
};

bot.onText(/^\/help$/, (msg) => helpHandler(msg.chat.id));
bot.on('callback_query', (query) => {
    if (query.data === 'help_btn') {
        helpHandler(query.message.chat.id);
        bot.answerCallbackQuery(query.id);
    }
});

// Fitur Admin: Stats
bot.onText(/^\/stats$/, (msg) => {
    const chatId = msg.chat.id;
    if (String(msg.from.id) !== String(adminId)) return;
    
    bot.sendMessage(chatId, `📊 <b>Statistik Bot</b>\n\n👥 Total Pengguna: <b>${users.length}</b> user.`, { parse_mode: 'HTML' });
});

// Fitur Admin: Broadcast
bot.onText(/^\/broadcast ([\s\S]+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (String(msg.from.id) !== String(adminId)) return;
    
    const message = match[1];
    bot.sendMessage(chatId, `Mulai mengirim broadcast ke ${users.length} user...`);
    
    let success = 0;
    for (const u of users) {
        try {
            await bot.sendMessage(u, `📢 <b>PENGUMUMAN</b>\n\n${message}`, { parse_mode: 'HTML' });
            success++;
            await delay(300); // Hindari limit broadcast
        } catch (e) {}
    }
    
    bot.sendMessage(chatId, `✅ Broadcast selesai!\nTerkirim ke: ${success}/${users.length} user.`);
});

// Fitur Cari 1 Username
bot.onText(/^\/cari (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (!(await isSubscribed(chatId, msg.from.id))) return;

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
bot.onText(/^\/bulk$/, async (msg) => {
    const chatId = msg.chat.id;
    if (!(await isSubscribed(chatId, msg.from.id))) return;
    helpHandler(chatId);
});

// Handler File TXT untuk Bulk
bot.on('document', async (msg) => {
    const chatId = msg.chat.id;
    if (!(await isSubscribed(chatId, msg.from.id))) return;
    
    if (!msg.document.file_name.endsWith('.txt')) {
        return;
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

        bot.sendMessage(chatId, `🚀 Ditemukan ${usernames.length} username.\nSistem sedang memfilter ketersediaan...\n\n✨ <i>Kesempatan emas amankan username incaran Anda tanpa repot!</i>\n\n<i>(Pengecekan mungkin butuh sedikit waktu demi menghindari limit dari Telegram)</i>`, { parse_mode: 'HTML' });
        
        await processUsernames(chatId, usernames);
    } catch (error) {
        bot.sendMessage(chatId, `⚠️ Gagal memproses file: ${error.message}`);
    }
});

// Handler Teks Biasa untuk Bulk (jika bukan command)
bot.on('text', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // Abaikan semua command yang diawali /
    if (text.startsWith('/')) return;
    
    if (!(await isSubscribed(chatId, msg.from.id))) return;

    // Memecah berdasarkan baris, koma, atau spasi
    const usernames = text.split(/[\n, ]+/)
        .map(u => u.trim().replace(/@/g, ''))
        .filter(u => u.length > 0);

    if (usernames.length === 0) return;

    bot.sendMessage(chatId, `🚀 Mulai memindai ${usernames.length} username...\n\n✨ <i>Duduk manis dan biarkan bot gratis ini bekerja mencarikan username terbaik untuk Anda!</i>`, { parse_mode: 'HTML' });
    await processUsernames(chatId, usernames);
});

// Fungsi inti untuk mengecek banyak username (Bulk)
async function processUsernames(chatId, usernames) {
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

        // Delay 1.5 detik untuk menjaga rate limit Telegram
        await delay(1500);
    }

    // Laporan Akhir
    const reportPath = path.join(__dirname, `report_${chatId}_${Date.now()}.txt`);
    let reportContent = `=== HASIL PENGECEKAN USERNAME ===\n`;
    reportContent += `Total dicek: ${usernames.length}\n`;
    reportContent += `Total Available: ${availableCount}\n\n`;

    reportContent += `--- ✅ MURNI AVAILABLE (BISA DIKLAIM) ---\n`;
    reportContent += availableList.join('\n') + '\n\n';

    reportContent += `--- 💎 TAKEN ATAU MASUK FRAGMENT ---\n`;
    reportContent += fragmentList.join('\n') + '\n';

    fs.writeFileSync(reportPath, reportContent);

    await bot.sendDocument(chatId, reportPath, {
        caption: `🎉 <b>Proses Selesai!</b>\nDari total ${usernames.length} username, berhasil disaring <b>${availableCount} username</b> yang murni tersedia.\n\n✨ <i>Semoga dapet username idamanmu ya! Manfaatkan fitur bot gratis ini kapan saja.</i>\n\nSilakan unduh dokumen laporan di atas untuk melihat detail lengkapnya.`,
        parse_mode: 'HTML'
    });

    fs.unlinkSync(reportPath);
}
