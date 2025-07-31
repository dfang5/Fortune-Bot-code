const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
require('dotenv').config();

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// --- Slash Command /info Registration ---
const infoCommand = new SlashCommandBuilder()
  .setName('info')
  .setDescription('Shows general info about the bot.');

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log('Registering slash command /info...');
    await rest.put(
      Routes.applicationCommands(clientId),
      { body: [infoCommand.toJSON()] },
    );
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

Commands: /info (this shows general info about the bot, and triggers the prompt you are seeing now.)
\`\`\`
    `;
    await interaction.reply(infoMessage.trim());
  }
});

// --- Inventory and Cooldowns Setup ---
const userData = new Map(); // Stores userId -> { cash, artefacts: [] }
const scavengeCooldowns = new Map();
const laborCooldowns = new Map();

const SCAVENGE_COOLDOWN = 2 * 60 * 60 * 1000; // 2 hours
const LABOR_COOLDOWN = 40 * 60 * 1000;        // 40 minutes

client.on('messageCreate', async message => {
  if (message.author.bot) return;

  const userId = message.author.id;
  const content = message.content.toLowerCase();

  // --- !scavenge Command ---
  if (content === '!scavenge') {
    const now = Date.now();
    const lastScavenge = scavengeCooldowns.get(userId);

    if (lastScavenge && (now - lastScavenge < SCAVENGE_COOLDOWN)) {
      const remaining = SCAVENGE_COOLDOWN - (now - lastScavenge);
      const hours = Math.floor(remaining / 3600000);
      const minutes = Math.floor((remaining % 3600000) / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);

      return message.reply(`You cannot scavenge yet. You must wait another **${hours}h ${minutes}m ${seconds}s**.`);
    }

    scavengeCooldowns.set(userId, now);

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

    const embed = new EmbedBuilder()
      .setDescription(`You have found a **${artefact}**!`)
      .setColor(result.color);

    message.reply({ embeds: [embed] });

    if (!userData.has(userId)) {
      userData.set(userId, { cash: 0, artefacts: [] });
    }
    const user = userData.get(userId);
    user.cash += result.value;
    user.artefacts.push(artefact);
  }

  // --- !labor Command ---
  else if (content === '!labor') {
    const now = Date.now();
    const lastLabor = laborCooldowns.get(userId);

    if (lastLabor && (now - lastLabor < LABOR_COOLDOWN)) {
      const remaining = LABOR_COOLDOWN - (now - lastLabor);
      const minutes = Math.floor(remaining / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);
      return message.reply(`You must wait **${minutes}m ${seconds}s** before laboring again.`);
    }

    laborCooldowns.set(userId, now);

    const earned = Math.floor(Math.random() * (400 - 50 + 1)) + 50;

    if (!userData.has(userId)) {
      userData.set(userId, { cash: 0, artefacts: [] });
    }
    userData.get(userId).cash += earned;

    message.reply(`You have earned **$${earned}** from labor!`);
  }

  // --- !inventory Command ---
  else if (content === '!inventory') {
    if (!userData.has(userId)) {
      return message.reply('You have nothing in your inventory yet.');
    }

    const user = userData.get(userId);
    const artefactList = user.artefacts.length > 0 ? user.artefacts.join(', ') : 'None';

    const embed = new EmbedBuilder()
      .setTitle(`${message.author.username}'s Inventory`)
      .addFields(
        { name: '💰 Cash', value: `$${user.cash}`, inline: true },
        { name: '📦 Artefacts', value: artefactList, inline: false }
      )
      .setColor(0x00AAFF);

    message.reply({ embeds: [embed] });
  }
});

client.once('ready', () => {
  console.log(`Fortune Bot is online as ${client.user.tag}`);
});

client.login(token);
