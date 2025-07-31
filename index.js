const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
} = require('discord.js');
require('dotenv').config();

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

const DATA_FILE = path.join(__dirname, 'data.json');
const COOLDOWN_FILE = path.join(__dirname, 'cooldowns.json');

// Load data
let userData = fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE)) : {};
let cooldowns = fs.existsSync(COOLDOWN_FILE) ? JSON.parse(fs.readFileSync(COOLDOWN_FILE)) : { scavenge: {}, labor: {} };

// Save functions
function saveUserData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(userData, null, 2));
}
function saveCooldowns() {
  fs.writeFileSync(COOLDOWN_FILE, JSON.stringify(cooldowns, null, 2));
}

// Artefact rarities
const rarities = [
  { name: 'Common', chance: 75, color: 0xAAAAAA, value: 100, sell: 150, items: ['Quartz', 'Mica', 'Olivine'] },
  { name: 'Uncommon', chance: 18, color: 0x00FF00, value: 700, sell: 550, items: ['Garnet', 'Talc', 'Magnetite'] },
  { name: 'Rare', chance: 5, color: 0x00008B, value: 2500, sell: 1500, items: ['Eye of Monazite', 'Chest of Xenotime', 'Euxenite'] },
  { name: 'Legendary', chance: 2.9, color: 0xFFD700, value: 10000, sell: 10000, items: ['Watch of Scandium', 'Statue of Bastnasite', 'Allanite'] },
  { name: 'Unknown', chance: 0.1, color: 0x000000, value: 1000000, sell: 1000000, items: ['Gem of Diamond', 'Kyawthuite'] }
];

// Discord client setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Register slash command
const infoCommand = new SlashCommandBuilder().setName('info').setDescription('Shows general info about the bot.');
const rest = new REST({ version: '10' }).setToken(token);
(async () => {
  try {
    await rest.put(Routes.applicationCommands(clientId), { body: [infoCommand.toJSON()] });
  } catch (error) {
    console.error('Failed to register command:', error);
  }
})();

// Handle /info
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'info') {
    const infoMessage = `
\`\`\`
Welcome to Fortune Bot, where you build your fortune in the form of virtual currency, collect rare artefacts, items, and equipment, trade with other players, and live in a world empowered by your own decisions!
Slash [/] Commands:
/info (this shows general info about the bot.)
Prefix [!] Commands:
!scavenge, !labor, !inventory, !sell
\`\`\``;
    await interaction.reply(infoMessage.trim());
  }
});

// Cooldowns
const SCAVENGE_COOLDOWN = 2 * 60 * 60 * 1000;
const LABOR_COOLDOWN = 40 * 60 * 1000;

// Helper to find artefact rarity
function getRarityByArtefact(name) {
  return rarities.find(r => r.items.includes(name));
}

// Main message command handler
client.on('messageCreate', async message => {
  if (message.author.bot) return;

  const userId = message.author.id;
  const content = message.content.toLowerCase();

  if (!userData[userId]) userData[userId] = { cash: 0, artefacts: [] };

  // --- !scavenge ---
  if (content === '!scavenge') {
    const now = Date.now();
    const last = cooldowns.scavenge[userId] || 0;

    if (now - last < SCAVENGE_COOLDOWN) {
      const remaining = SCAVENGE_COOLDOWN - (now - last);
      const h = Math.floor(remaining / 3600000);
      const m = Math.floor((remaining % 3600000) / 60000);
      const s = Math.floor((remaining % 60000) / 1000);
      return message.reply(`You cannot scavenge yet. You must wait **${h}h ${m}m ${s}s**.`);
    }

    cooldowns.scavenge[userId] = now;
    saveCooldowns();

    const roll = Math.random() * 100;
    let cumulative = 0;
    let result = rarities[0];

    for (const rarity of rarities) {
      cumulative += rarity.chance;
      if (roll <= cumulative) {
        result = rarity;
        break;
      }
    }

    const artefact = result.items[Math.floor(Math.random() * result.items.length)];
    userData[userId].cash += result.value;
    userData[userId].artefacts.push(artefact);
    saveUserData();

    const embed = new EmbedBuilder()
      .setDescription(`You have found a **${artefact}**! [${result.name}, ${result.chance}%]`)
      .setColor(result.color);
    return message.reply({ embeds: [embed] });
  }

  // --- !labor ---
  else if (content === '!labor') {
    const now = Date.now();
    const last = cooldowns.labor[userId] || 0;

    if (now - last < LABOR_COOLDOWN) {
      const remaining = LABOR_COOLDOWN - (now - last);
      const m = Math.floor(remaining / 60000);
      const s = Math.floor((remaining % 60000) / 1000);
      return message.reply(`You must wait **${m}m ${s}s** before laboring again.`);
    }

    cooldowns.labor[userId] = now;
    saveCooldowns();

    const earned = Math.floor(Math.random() * (400 - 50 + 1)) + 50;
    userData[userId].cash += earned;
    saveUserData();

    return message.reply(`You have earned **$${earned}** from labor!`);
  }

  // --- !inventory ---
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

  // --- !sell ---
  else if (content === '!sell') {
    const artefacts = userData[userId].artefacts;

    if (!artefacts.length) {
      return message.reply('You have no artefacts. Use !scavenge to acquire one!');
    }

    const options = [...new Set(artefacts)].map(item => ({
      label: item,
      value: item
    }));

    const menu = new StringSelectMenuBuilder()
      .setCustomId('select_artefact')
      .setPlaceholder('Choose an artefact to sell')
      .addOptions(options.slice(0, 25));

    const row = new ActionRowBuilder().addComponents(menu);
    const prompt = await message.reply({
      content: 'Which artefact would you like to sell?',
      components: [row]
    });

    const collector = prompt.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      time: 15000,
      max: 1
    });

    collector.on('collect', async interaction => {
      if (interaction.user.id !== message.author.id) return;

      const selected = interaction.values[0];
      const rarity = getRarityByArtefact(selected);
      const price = rarity ? rarity.sell : 0;

      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('confirm_sell')
          .setStyle(ButtonStyle.Success)
          .setEmoji('✅'),
        new ButtonBuilder()
          .setCustomId('cancel_sell')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('❌')
      );

      await interaction.reply({
        content: `Are you sure you want to sell **${selected}** for **$${price}**?`,
        components: [confirmRow]
      });

      const btnCollector = interaction.channel.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 15000,
        max: 1
      });

      btnCollector.on('collect', async btn => {
        if (btn.user.id !== message.author.id) return;

        if (btn.customId === 'confirm_sell') {
          const index = userData[userId].artefacts.indexOf(selected);
          if (index > -1) userData[userId].artefacts.splice(index, 1);
          userData[userId].cash += price;
          saveUserData();
          await btn.reply(`You have successfully completed the transaction.`);
        } else {
          await btn.reply('You have cancelled the transaction.');
        }
      });
    });
  }
});

client.once('ready', () => {
  console.log(`Fortune Bot is online as ${client.user.tag}`);
});
client.login(token);
