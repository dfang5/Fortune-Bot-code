// start of index.js 
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
require('dotenv').config();

// Load environment variables
const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

// Create client with expanded intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Define the /info command
const infoCommand = new SlashCommandBuilder()
  .setName('info')
  .setDescription('Shows general info about the bot.');

// Register the slash command
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

// Respond to slash interactions
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

// Respond to !scavenge
client.on('messageCreate', async message => {
  if (message.author.bot) return;

  if (message.content.toLowerCase() === '!scavenge') {
    const rarities = [
      {
        name: 'Common',
        chance: 75,
        color: 0xAAAAAA,
        value: 100,
        items: ['Quartz', 'Mica', 'Olivine']
      },
      {
        name: 'Uncommon',
        chance: 18,
        color: 0x00FF00,
        value: 700,
        items: ['Garnet', 'Talc', 'Magnetite']
      },
      {
        name: 'Rare',
        chance: 5,
        color: 0x00008B,
        value: 2500,
        items: ['Eye of Monazite', 'Chest of Xenotime', 'Euxenite']
      },
      {
        name: 'Legendary',
        chance: 2.9,
        color: 0xFFD700,
        value: 10000,
        items: ['Watch of Scandium', 'Statue of Bastnasite', 'Allanite']
      },
      {
        name: 'Unknown',
        chance: 0.1,
        color: 0x000000,
        value: 1000000,
        items: ['Gem of Diamond', 'Kyawthuite']
      }
    ];

    // Roll a rarity
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

    // Fallback if somehow no result
    if (!result) result = rarities[0];

    const artefact = result.items[Math.floor(Math.random() * result.items.length)];

    const embed = new EmbedBuilder()
      .setDescription(`You have found a **${artefact}**!`)
      .setColor(result.color);

    message.reply({ embeds: [embed] });

    // Optional logging
    console.log(`User ${message.author.tag} scavenged and found ${artefact} (${result.name}) worth $${result.value}`);
  }
});

client.once('ready', () => {
  console.log(`Fortune Bot is online as ${client.user.tag}`);
});

client.login(token);
