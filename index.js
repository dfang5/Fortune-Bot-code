// start of index.js (nihaoo you better read this or i'll skin you alive)
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

// Load environment variables
const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

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

// Respond to interactions
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

client.once('ready', () => {
  console.log(`Fortune Bot is online as ${client.user.tag}`);
});

client.login(token);
