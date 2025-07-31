const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
require('dotenv').config();

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

const DATA_FILE = path.join(__dirname, 'data.json');
const COOLDOWN_FILE = path.join(__dirname, 'cooldowns.json');

// --- Load Persistent User Data ---
let userData = {};
if (fs.existsSync(DATA_FILE)) {
  try {
    const rawData = fs.readFileSync(DATA_FILE);
    userData = JSON.parse(rawData);
  } catch (error) {
    console.error('Failed to load user data:', error);
  }
}

// --- Load Persistent Cooldowns ---
let cooldowns = { scavenge: {}, labor: {} };
if (fs.existsSync(COOLDOWN_FILE)) {
  try {
    const rawCooldowns = fs.readFileSync(COOLDOWN_FILE);
    cooldowns = JSON.parse(rawCooldowns);
  } catch (error) {
    console.error('Failed to load cooldowns:', error);
  }
}

// --- Save User Data to File ---
function saveUserData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(userData, null, 2));
  } catch (error) {
    console.error('Failed to save user data:', error);
  }
}

// --- Save Cooldowns to File ---
function saveCooldowns() {
  try {
    fs.writeFileSync(COOLDOWN_FILE, JSON.stringify(cooldowns, null, 2));
  } catch (error) {
    console.error('Failed to save cooldowns:', error);
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// --- Register Slash Command /info ---
const infoCommand = new SlashCommandBuilder()
  .setName('info')
  .setDescription('Shows general info about the bot.');

const rest = new REST({ version: '10' }).setToken(token);
(async () => {
  try {
    console.log('Registering slash command /info...');
    await rest.put(Routes.applicationCommands(clientId), { body: [infoCommand.toJSON()] });
    console.log('Slash command /info registered successfully.');
  } catch (error) {
    console.error('Failed to register command:', error);
  }
})();

// --- Slash Command Handler ---
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'info') {
    const infoMessage = `
\`\`\`
Welcome to Fortune Bot, where you build your fortune in the form of virtual currency, collect rare artefacts, items, and equipment, trade with other players, and live in a world empowered by your own decisions! 
Slash [/] Commands:
/info (this shows general info about the bot.)
Prefix [!] Commands:
!scavenge, !labor, !inventory
\`\`\`
    `;
    await interaction.reply(infoMessage.trim());
  }
});

// --- Cooldown Timers ---
const SCAVENGE_COOLDOWN = 2 * 60 * 60 * 1000; // 2 hours
const LABOR_COOLDOWN = 40 * 60 * 1000;        // 40 minutes

client.on('messageCreate', async message => {
  if (message.author.bot) return;

  const userId = message.author.id;
  const content = message.content.toLowerCase();

  if (!userData[userId]) {
    userData[userId] = { cash: 0, artefacts: [] };
  }

  // --- !scavenge Command ---
  if (content === '!scavenge') {
    const now = Date.now();
    const lastScavenge = cooldowns.scavenge[userId] || 0;

    if (now - lastScavenge < SCAVENGE_COOLDOWN) {
      const remaining = SCAVENGE_COOLDOWN - (now - lastScavenge);
      const hours = Math.floor(remaining / 3600000);
      const minutes = Math.floor((remaining % 3600000) / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);
      return message.reply(`You cannot scavenge yet. You must wait another **${hours}h ${minutes}m ${seconds}s**.`);
    }

    cooldowns.scavenge[userId] = now;
    saveCooldowns();

    const rarities = [
      { name: 'Common', chance: 75, color: 0xAAAAAA, value: 100, items: ['Quartz', 'Mica', 'Olivine'] },
      { name: 'Uncommon', chance: 18, color: 0x00FF00, value: 700, items: ['Garnet', 'Talc', 'Magnetite'] },
      { name: 'Rare', chance: 5, color: 0x00008B, value: 2500, items: ['Eye of Monazite', 'Chest of Xenotime', 'Euxenite'] },
      { name: 'Legendary', chance: 2.9, color: 0xFFD700, value: 10000, items: ['Watch of Scandium', 'Statue of Bastnasite', 'Allanite'] },
      { name: 'Unknown', chance: 0.1, color: 0x000000, value: 1000000, items: ['Gem of Diamond', 'Kyawthuite'] }
    ];

    const roll = Math.random() * 100;
    let cumulative = 0;
    let result;
    for (const rarity of rarities) {
      cumulative += rarity.chance;
      if (roll <= cumulative) {
        result = rarity;
        break;
      }
    }
    if (!result) result = rarities[0];

    const artefact = result.items[Math.floor(Math.random() * result.items.length)];
    userData[userId].cash += result.value;
    userData[userId].artefacts.push(artefact);
    saveUserData();

    const embed = new EmbedBuilder()
      .setDescription(`You have found a **${artefact}**!`)
      .setColor(result.color);

    return message.reply({ embeds: [embed] });
  }

  // --- !labor Command ---
  else if (content === '!labor') {
    const now = Date.now();
    const lastLabor = cooldowns.labor[userId] || 0;

    if (now - lastLabor < LABOR_COOLDOWN) {
      const remaining = LABOR_COOLDOWN - (now - lastLabor);
      const minutes = Math.floor(remaining / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);
      return message.reply(`You must wait **${minutes}m ${seconds}s** before laboring again.`);
    }

    cooldowns.labor[userId] = now;
    saveCooldowns();

    const earned = Math.floor(Math.random() * (400 - 50 + 1)) + 50;
    userData[userId].cash += earned;
    saveUserData();

    return message.reply(`You have earned **$${earned}** from labor!`);
  }

  // --- !inventory Command ---
  else if (content === '!inventory') {
    const user = userData[userId];
    const artefactList = user.artefacts.length > 0 ? user.artefacts.join(', ') : 'None';

    const embed = new EmbedBuilder()
      .setTitle(`${message.author.username}'s Inventory`)
      .addFields(
        { name: '💰 Cash', value: `$${user.cash}`, inline: true },
        { name: '📦 Artefacts', value: artefactList, inline: false }
      )
      .setColor(0x00AAFF);

    return message.reply({ embeds: [embed] });
  }
});

client.once('ready', () => {
  console.log(`Fortune Bot is online as ${client.user.tag}`);
});

client.login(token);
