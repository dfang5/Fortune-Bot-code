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
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
} = require('discord.js');
require('dotenv').config();
const DEVELOPER_ID = '1299875574894039184';
const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const DATA_FILE = path.join(__dirname, 'data.json');
const COOLDOWN_FILE = path.join(__dirname, 'cooldowns.json');

// Load persistent data
let userData = fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE)) : {};
let cooldowns = fs.existsSync(COOLDOWN_FILE) ? JSON.parse(fs.readFileSync(COOLDOWN_FILE)) : { scavenge: {}, labor: {} };

if (!userData.guildItems) userData.guildItems = {}; // 🧠 Server-specific custom items
global.tempItems = {}; // 💾 Store items awaiting confirmation

// Save functions
function saveUserData() { fs.writeFileSync(DATA_FILE, JSON.stringify(userData, null, 2)); }
function saveCooldowns() { fs.writeFileSync(COOLDOWN_FILE, JSON.stringify(cooldowns, null, 2)); }

// Rarity and artefact config
const rarities = [
  { name:'Common', chance:65, color:0xAAAAAA, value:100, sell:150, items:['Quartz','Mica','Olivine'] },
  { name:'Uncommon', chance:20, color:0x00FF00, value:700, sell:550, items:['Garnet','Talc','Magnetite'] },
  { name:'Rare', chance:10, color:0x00008B, value:2500, sell:1500, items:['Eye of Monazite','Chest of Xenotime','Euxenite'] },
  { name:'Legendary', chance:4, color:0xFFD700, value:10000, sell:10000, items:['Watch of Scandium','Statue of Bastnasite','Allanite'] },
  { name:'Unknown', chance:1, color:0x000000, value:1000000, sell:1000000, items:['Gem of Diamond','Kyawthuite'] }
];
function getRarityByArtefact(name) { return rarities.find(r => r.items.includes(name)); }

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Register slash command /info
const infoCommand = new SlashCommandBuilder().setName('info').setDescription('Shows information about the bot.');
const rest = new REST({ version:'10' }).setToken(token);
(async () => {
  try {
    await rest.put(Routes.applicationCommands(clientId), { body: [infoCommand.toJSON()] });
  } catch (err) { console.error(err); }
})();

client.once('ready', () => {
  console.log(`Fortune Bot online as ${client.user.tag}`);
});

// Handle slash /info
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'info') return;

  const infoEmbed = new EmbedBuilder()
    .setTitle('🎰 Fortune Bot - Build Your Empire!')
    .setDescription('💎 Welcome to Fortune Bot, where you build your fortune in virtual currency, collect rare artefacts, trade with others, and shape your destiny!')
    .setColor(0xFFD700) // Gold color
    .setThumbnail('https://cdn.discordapp.com/emojis/741713906411708517.png') // Generic treasure chest emoji URL
    .addFields(
      {
        name: '⚡ Slash Commands',
        value: '`/info` - Shows this information panel',
        inline: false
      },
      {
        name: '🎮 Game Commands',
        value: [
          '`!scavenge` - Search for rare artefacts (2h cooldown)',
            '`!labor` - Work to earn money (40min cooldown)',
            '`!inventory` - View your cash, bank balance and artefacts',
            '`!sell` - Sell your artefacts for cash',
            '`!trade @user` - Start a trade with another user',
            '`!leaderboard (or !lb) - View the leaderboard and your current rating',
            '`!store - View all the items that admins have added',
            '`!add-item (Admin-Only) - add an item into a guild/server',
            '`!view-items (Admin-Only) - Access the masterboard to configure items',
            '`!remove-item (Admin-Only) - Removes a specific item from a server (you must specify the number)',
            '`!give-item (Admin-Only) - Gives an item to any player'
          ].join('\n'),
          inline: false
          },
          {
          name: '💰 Trading System',
          value: [
            '`You can interact with buttons to either add or remove artefacts/items/cash.'
        ].join('\n'),
        inline: false
      },
      {
        name: '🏦 Banking System',
        value: [
          '`!bank {amount}` - Deposit money (max $50,000 total)',
          '`!withdraw {amount}` - Withdraw money from bank',
          '`!steal @user {amount}` - Steal cash from other players',
          '**Note:** Only cash on hand can be stolen, bank money is protected!'
        ].join('\n'),
        inline: false
      },
      {
        name: '🏆 Rarity Levels',
        value: [
          '⚪ **Common** (65%) - $100-150',
          '🟢 **Uncommon** (20%) - $550-700',
          '🔵 **Rare** (10%) - $1,500-2,500',
          '🟡 **Legendary** (4%) - $5,000',
          '⚫ **Unknown** (1%) - $15,000'
        ].join('\n'),
        inline: false
      }
    )
    .setFooter({
      text: '💡 Tip: Start with !scavenge to find your first artefact!',
      iconURL: 'https://cdn.discordapp.com/emojis/692428747226898492.png'
    })
    .setTimestamp();

  await interaction.reply({ embeds: [infoEmbed] });
});

// Trade storage
const activeTrades = {}; // tradeId → trade object
function newTradeId() { return Math.random().toString(36).substr(2, 8); }

// Marble game storage
const activeMarbleGames = {}; // gameId → game object
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  const userId = message.author.id;
  const content = message.content.toLowerCase();

  if (!userData[userId]) userData[userId] = { cash: 0, artefacts: [], bankBalance: 0 };

  // Banking System Commands (here we go again...)

  // !bank {amount} - Deposit money
  if (content.startsWith('!bank ')) {
    const args = content.split(' ').slice(1);
    const amount = parseInt(args[0], 10);

    if (isNaN(amount) || amount <= 0) {
      return message.reply('❌ Please enter a valid amount to deposit. Example: `!bank 1000`');
    }

    const currentBank = userData[userId].bankBalance || 0;
    const maxDeposit = 50000 - currentBank;

    if (amount > maxDeposit) {
      return message.reply(`❌ You can only deposit $${maxDeposit.toLocaleString()} more. Your bank limit is $50,000 and you currently have $${currentBank.toLocaleString()} stored.`);
    }

    if (userData[userId].cash < amount) {
      return message.reply(`❌ You don't have enough cash! You have $${userData[userId].cash.toLocaleString()} but tried to deposit $${amount.toLocaleString()}.`);
    }

    userData[userId].cash -= amount;
    userData[userId].bankBalance = currentBank + amount;
    saveUserData();

    const embed = new EmbedBuilder()
      .setTitle('Deposit Successful!')
      .setDescription(`You deposited $${amount.toLocaleString()} into your bank account.`)
      .addFields(
        { name: 'Cash on Hand', value: `$${userData[userId].cash.toLocaleString()}`, inline: true },
        { name: 'Bank Balance', value: `$${userData[userId].bankBalance.toLocaleString()}`, inline: true },
        { name: 'Bank Capacity', value: `${((userData[userId].bankBalance / 50000) * 100).toFixed(1)}%`, inline: true }
      )
      .setColor(0x00AA00)
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }

  // !withdraw {amount} - Withdraw money from bank
  if (content.startsWith('!withdraw ')) {
    const args = content.split(' ').slice(1);
    const amount = parseInt(args[0], 10);

    if (isNaN(amount) || amount <= 0) {
      return message.reply('❌ Please enter a valid amount to withdraw. Example: `!withdraw 1000`');
    }

    const currentBank = userData[userId].bankBalance || 0;

    if (amount > currentBank) {
      return message.reply(`❌ You don't have enough in your bank! You have $${currentBank.toLocaleString()} but tried to withdraw $${amount.toLocaleString()}.`);
    }

    userData[userId].bankBalance = currentBank - amount;
    userData[userId].cash += amount;
    saveUserData();

    const embed = new EmbedBuilder()
      .setTitle('Withdrawal Successful!')
      .setDescription(`You withdrew $${amount.toLocaleString()} from your bank account.`)
      .addFields(
        { name: 'Cash on Hand', value: `$${userData[userId].cash.toLocaleString()}`, inline: true },
        { name: 'Bank Balance', value: `$${userData[userId].bankBalance.toLocaleString()}`, inline: true },
        { name: 'Bank Capacity', value: `${((userData[userId].bankBalance / 50000) * 100).toFixed(1)}%`, inline: true }
      )
      .setColor(0x0099FF)
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }

  // !steal @user {amount} - Steal money from another user
  if (content.startsWith('!steal ')) {
    const mentioned = message.mentions.users.first();
    if (!mentioned) {
      return message.reply('❌ You must mention a user to steal from! Example: `!steal @user 500`');
    }

    if (mentioned.id === userId) {
      return message.reply('❌ You cannot steal from yourself!');
    }

    const args = content.split(' ').slice(2);
    const amount = parseInt(args[0], 10);

    if (isNaN(amount) || amount <= 0) {
      return message.reply('❌ Please enter a valid amount to steal. Example: `!steal @user 500`');
    }

    const targetId = mentioned.id;
    if (!userData[targetId]) userData[targetId] = { cash: 0, artefacts: [], bankBalance: 0 };

    // Only cash on hand can be stolen (not bank money)
    const availableCash = userData[targetId].cash;

    if (amount > availableCash) {
      return message.reply(`❌ ${mentioned.username} only has $${availableCash.toLocaleString()} available to steal! (Bank money is protected)`);
    }

    // Calculate success rate based on amount
    // Formula: Base 80% success, decreases as amount increases
    // $100 = ~75%, $400 = ~50%, $1000 = ~25%, $2000+ = ~10%
    // Minimum success rate is 10% to prevent impossible steals
    // Maximum success rate is 80% to prevent guaranteed steals
    // This really took a lot of time to make :3 
    let successRate = Math.max(10, 80 - (amount / 20));
    successRate = Math.min(80, successRate); // Cap at 80%

    const randomRoll = Math.random() * 100;
    const isSuccess = randomRoll <= successRate;

    if (isSuccess) {
      // Successful steal
      userData[targetId].cash -= amount;
      userData[userId].cash += amount;
      saveUserData();

      const embed = new EmbedBuilder()
        .setTitle('💰 Theft Successful!')
        .setDescription(`You successfully stole $${amount.toLocaleString()} from ${mentioned.username}!`)
        .addFields(
          { name: 'Success Rate', value: `${successRate.toFixed(1)}%`, inline: true },
          { name: 'Your Roll', value: `${randomRoll.toFixed(1)}%`, inline: true },
          { name: 'Your Cash', value: `$${userData[userId].cash.toLocaleString()}`, inline: true }
        )
        .setColor(0x00AA00)
        .setTimestamp();

      await message.reply({ embeds: [embed] });

      // Notify the victim
      const victimEmbed = new EmbedBuilder()
        .setTitle('You Were Robbed!')
        .setDescription(`${message.author.username} stole $${amount.toLocaleString()} from you!`)
        .addFields(
          { name: '💰 Remaining Cash', value: `$${userData[targetId].cash.toLocaleString()}`, inline: true },
          { name: '🏦 Bank Balance', value: `$${userData[targetId].bankBalance || 0}`, inline: true },
          { name: '💡 Tip', value: 'Keep your money in the bank to protect it!', inline: false }
        )
        .setColor(0xFF0000)
        .setTimestamp();

      try {
        await mentioned.send({ embeds: [victimEmbed] });
      } catch (error) {
        // User has DMs disabled, ignore
      }

    } else {
      // Failed steal
      const embed = new EmbedBuilder()
        .setTitle('❌ Theft Failed!')
        .setDescription(`You failed to steal from ${mentioned.username}! Try stealing a smaller number, they increase your chances of success.`)
        .addFields(
          { name: 'Success Rate', value: `${successRate.toFixed(1)}%`, inline: true },
          { name: 'Your Roll', value: `${randomRoll.toFixed(1)}%`, inline: true },
          { name: 'Result', value: 'Mission Failed!', inline: true }
        )
        .setColor(0xFF0000)
        .setTimestamp();

      return message.reply({ embeds: [embed] });
    }
  }

// Cooldowns
const SCAVENGE_COOLDOWN = 2 * 60 * 60 * 1000;
const LABOR_COOLDOWN = 40 * 60 * 1000;

// Enhanced Trade UI Functions
function createTradeRequestEmbed(fromUser, toUser) {
  return new EmbedBuilder()
    .setTitle('Trade Request')
    .setDescription(`✨ **<@${fromUser}>** wants to start a trading session with **<@${toUser}>**!\n\n🎯 Ready to exchange valuable artefacts and fortune?`)
    .addFields(
      {
        name: 'What happens next?',
        value: '• Accept to enter the interactive trading interface\n• Decline to politely refuse this trade',
        inline: false
      },
      {
        name: 'Trading Tips',
        value: '• Both parties can add artefacts and money\n• Review everything before confirming\n• Trades are secure and instant',
        inline: false
      }
    )
    .setColor(0x7289DA)
    .setThumbnail('https://cdn.discordapp.com/emojis/741713906411708517.png')
    .setFooter({ text: 'Trade expires in 60 seconds' })
    .setTimestamp();
}

function createTradeInterfaceEmbed(trade, fromUser, toUser) {
  const fromUserInt = trade.from;
  const toUserInt = trade.to;
  const fromOffer = trade.offers[fromUserInt] || { cash: 0, artefacts: [] };
  const toOffer = trade.offers[toUserInt] || { cash: 0, artefacts: [] };

  const fromArtefacts = fromOffer.artefacts?.length ? fromOffer.artefacts.map(art => {
    const rarity = getRarityByArtefact(art);
    const rarityEmoji = rarity ?
      (rarity.name === 'Common' ? '⚪' :
       rarity.name === 'Uncommon' ? '🟢' :
       rarity.name === 'Rare' ? '🔵' :
       rarity.name === 'Legendary' ? '🟡' : '⚫') : '❓';
    return `${rarityEmoji} ${art}`;
  }).join('\n') : '🚫 No artefacts offered';

  const toArtefacts = toOffer.artefacts?.length ? toOffer.artefacts.map(art => {
    const rarity = getRarityByArtefact(art);
    const rarityEmoji = rarity ?
      (rarity.name === 'Common' ? '⚪' :
       rarity.name === 'Uncommon' ? '🟢' :
       rarity.name === 'Rare' ? '🔵' :
       rarity.name === 'Legendary' ? '🟡' : '⚫') : '❓';
    return `${rarityEmoji} ${art}`;
  }).join('\n') : '🚫 No artefacts offered';

  const totalFromValue = (fromOffer.cash || 0) + (fromOffer.artefacts?.reduce((sum, art) => {
    const rarity = getRarityByArtefact(art);
    return sum + (rarity ? rarity.value : 0);
  }, 0) || 0);

  const totalToValue = (toOffer.cash || 0) + (toOffer.artefacts?.reduce((sum, art) => {
    const rarity = getRarityByArtefact(art);
    return sum + (rarity ? rarity.value : 0);
  }, 0) || 0);

  return new EmbedBuilder()
    .setTitle('Interactive Trading Interface')
    .setDescription(`**Live Trade Session Active**\n\n Use the buttons below to manage your offers!`)
    .addFields(
      {
        name: `${fromUser}'s Offer`,
        value: `**Artefacts:**\n${fromArtefacts}\n\n💰 **Cash:** $${(fromOffer.cash || 0).toLocaleString()}\n📊 **Total Value:** ~$${totalFromValue.toLocaleString()}`,
        inline: true
      },
      {
        name: '⚖️ VS',
        value: '```\n  ⚡\n /||\\\n  ||\n  💎\n```',
        inline: true
      },
      {
        name: `👤 ${toUser}'s Offer`,
        value: `**Artefacts:**\n${toArtefacts}\n\n💰 **Cash:** $${(toOffer.cash || 0).toLocaleString()}\n📊 **Total Value:** ~$${totalToValue.toLocaleString()}`,
        inline: true
      },
      {
        name: '🎯 Quick Actions:',
        value: '🎒 Add artefacts from your inventory\n💵 Add money to sweeten the deal\n✅ Confirm when both sides are ready.',
        inline: false
      }
    )
    .setColor(0xFFD700)
    .setThumbnail('https://cdn.discordapp.com/emojis/741713906411708517.png')
    .setFooter({ text: '⚠️ Both players must confirm to complete the trade.' })
    .setTimestamp();
}

function createTradeControls(tradeId, userId, isReady = false) {
  const readyStyle = isReady ? ButtonStyle.Success : ButtonStyle.Secondary;
  const readyLabel = isReady ? '✅ Ready!' : '⏳ Ready?';

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`trade_add_art_${tradeId}_${userId}`)
        .setLabel('Add Artefact')
        .setEmoji('🎒')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`trade_add_money_${tradeId}_${userId}`)
        .setLabel('Add Money')
        .setEmoji('💰')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`trade_ready_${tradeId}_${userId}`)
        .setLabel(readyLabel)
        .setStyle(readyStyle)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`trade_cancel_${tradeId}`)
        .setLabel('Cancel Trade')
        .setEmoji('❌')
        .setStyle(ButtonStyle.Danger)
    )
  ];
}
//leaderboard helper code (nihaoo read this)
function showLeaderboardPage(message, page) {
  const users = Object.entries(userData)
    .filter(([id, data]) => data.cash !== undefined)
    .sort((a, b) => b[1].cash - a[1].cash);

  const totalPages = Math.ceil(users.length / 10);
  const start = page * 10;
  const current = users.slice(start, start + 10);

  const leaderboardEmbed = new EmbedBuilder()
    .setTitle('💰 Top Fortune Holders')
    .setDescription(current.map(([id, data], i) => {
      const rank = start + i + 1;
      return `**${rank}.** <@${id}> — $${data.cash.toLocaleString()}`;
    }).join('\n') || 'No players yet!')
    .setFooter({ text: `Page ${page + 1} of ${totalPages}` })
    .setColor(0xFFD700);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`leaderboard_prev_${page}`)
      .setLabel('⬅️ Prev')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(`leaderboard_next_${page}`)
      .setLabel('➡️ Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1)
  );

  return message.channel.send({ embeds: [leaderboardEmbed], components: [row] });
}

});

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  const userId = message.author.id;
  const content = message.content.toLowerCase();

  if (!userData[userId]) userData[userId] = { cash:0, artefacts:[] };

  // !leaderboard or !lb
  if (content === '!leaderboard' || content === '!lb') {
    return showLeaderboardPage(message, 0);
  }

  // !add-item
  if (content === '!add-item') {
    const guildId = message.guild?.id;

    // Only allow admins or you
    if (!message.member.permissions.has('Administrator') && message.author.id !== '1299875574894039184') {
      return message.reply('🚫 You do not have permission to create server items.');
    }

    // Send button
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const addItemButton = new ButtonBuilder()
      .setCustomId('start_add_item')
      .setLabel('➕ Create New Item')
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(addItemButton);

    return message.reply({
      content: '✨ Ready to create a new custom item? Click below to get started!',
      components: [row]
    });
  }

  // !remove-item
  if (content.startsWith('!remove-item')) {
    if (!message.member.permissions.has('Administrator') && message.author.id !== '1299875574894039184') {
      return message.reply('❌ You don’t have permission to remove items.');
    }

    const args = content.split(' ').slice(1);
    const index = parseInt(args[0], 10) - 1; // user enters item number from !view-items

    const guildId = message.guild?.id;
    const items = userData.guildItems?.[guildId];

    if (!items || items.length === 0) {
      return message.reply('📭 No server items found.');
    }

    if (isNaN(index) || index < 0 || index >= items.length) {
      return message.reply(`⚠ Please specify a valid item number. Use \`!view-items\` to see the list.`);
    }

    const removedItem = items.splice(index, 1)[0];

    // Save changes
    userData.guildItems[guildId] = items;
    fs.writeFileSync('./data.json', JSON.stringify(userData, null, 2));

    const { EmbedBuilder } = require('discord.js');
    const embed = new EmbedBuilder()
      .setTitle('🗑 Item Removed')
      .setColor(0xFF0000) // Red
      .setDescription(`**${removedItem.name}** has been removed from the server’s custom items.`)
      .setFooter({ text: `Removed by ${message.author.tag}`, iconURL: message.author.displayAvatarURL({ dynamic: true }) })
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }

  // !view-items
  if (content === '!view-items') {
    const guildId = message.guild?.id;
    const items = userData.guildItems?.[guildId];

    if (!items || items.length === 0) {
      return message.reply('📭 No server items found. Use `!add-item` to create one.');
    }

    const { EmbedBuilder } = require('discord.js');

    const embed = new EmbedBuilder()
      .setTitle(`📦 ${message.guild.name} — Custom Items`)
      .setColor(0xFFD700) // Gold
      .setThumbnail(message.guild.iconURL({ dynamic: true }))
      .setDescription(
        items
          .map((item, i) =>
            `**${i + 1}. ${item.name}**\n💰 **$${item.value.toLocaleString()}**\n📝 ${item.desc}`
          )
          .join('\n\n')
      )
      .setFooter({ text: `Total Items: ${items.length} | Requested by ${message.author.tag}`, iconURL: message.author.displayAvatarURL({ dynamic: true }) })
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }

  // !give-item @user Item Name
  if (content.startsWith('!give-item')) {
    if (!message.member.permissions.has('Administrator')) {
      return message.reply('❌ You must be a server admin to use this command.');
    }

    const mentioned = message.mentions.users.first();
    if (!mentioned) return message.reply('Please mention a user to give an item to.');

    const args = message.content.split(' ').slice(2); // Skip '!give-item' and mention
    const itemName = args.join(' ').trim();
    if (!itemName) return message.reply('Specify an item name to give.');

    const guildId = message.guild.id;
    const items = userData.guildItems?.[guildId] || [];
    const item = items.find(i => i.name.toLowerCase() === itemName.toLowerCase());

    if (!item) return message.reply(`❌ No item named **${itemName}** found.`);

    const targetId = mentioned.id;
    if (!userData[targetId]) userData[targetId] = { cash: 0, artefacts: [] };
    userData[targetId].artefacts.push(item.name);
    saveUserData();

    const embed = new EmbedBuilder()
      .setTitle('🎁 Item Granted!')
      .setDescription(`✅ **${item.name}** was given to <@${targetId}>.`)
      .addFields(
        { name: '💰 Value', value: `$${item.value}`, inline: true },
        { name: '📝 Description', value: item.desc, inline: false }
      )
      .setColor(0x00FF00)
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }

  // !scavenge
  if (content === '!scavenge') {
    const now = Date.now(), last = cooldowns.scavenge[userId] || 0;
    if (now - last < SCAVENGE_COOLDOWN) {
      const rem = SCAVENGE_COOLDOWN - (now - last);
      const h = Math.floor(rem / 3600000), m = Math.floor((rem % 3600000)/60000), s = Math.floor((rem%60000)/1000);
      return message.reply(`You cannot scavenge yet. Wait ${h}h ${m}m ${s}s.`);
    }
    cooldowns.scavenge[userId] = now; saveCooldowns();
    const roll = Math.random() * 100; let cum = 0, res = rarities[0];
    for (const r of rarities) { cum += r.chance; if (roll <= cum) { res = r; break; } }
    const art = res.items[Math.floor(Math.random()*res.items.length)];
    userData[userId].artefacts.push(art); saveUserData();
    const embed = new EmbedBuilder().setDescription(`You have found a **${art}**! [${res.name}, ${res.chance}%]`).setColor(res.color);
    return message.reply({ embeds: [embed] });
  }

  // !labor - Fixed to ensure exact amount is added
  if (content === '!labor') {
    const now = Date.now(), last = cooldowns.labor[userId] || 0;
    if (now - last < LABOR_COOLDOWN) {
      const rem = LABOR_COOLDOWN - (now - last);
      const m = Math.floor(rem/60000), s = Math.floor((rem%60000)/1000);
      return message.reply(`You must wait **${m}m ${s}s** before laboring again.`);
    }
    cooldowns.labor[userId] = now;
    saveCooldowns();

    // Generate random amount between 50-400
    const earned = Math.floor(Math.random() * (400 - 50 + 1)) + 50;

    // Store previous cash for verification
    const previousCash = userData[userId].cash;

    // Add exactly the earned amount
    userData[userId].cash = previousCash + earned;

    saveUserData();

    return message.reply(`You have earned **$${earned}** from labor! (Previous: $${previousCash}, New: $${userData[userId].cash})`);
  }

  // !store
  if (content === '!store') {
      const guildId = message.guild?.id;
      const items = userData.guildItems?.[guildId] || [];

      if (!items.length) {
          return message.reply('📭 No items available in the store. Use `!add-item` to add some.');
      }

      const storeEmbed = new EmbedBuilder()
          .setTitle(`🏪 ${message.guild.name} Store`)
          .setColor(0xFFD700)
          .setDescription('Click the buttons below to purchase an item!')
          .addFields(items.map(item => ({
              name: `🛒 ${item.name} — 💰 $${item.value}`,
              value: item.desc,
              inline: false
          })))
          .setFooter({ text: `Total Items: ${items.length} | Your Balance: $${userData[message.author.id]?.cash || 0}` });

      const row = new ActionRowBuilder()
          .addComponents(items.map((item, i) =>
              new ButtonBuilder()
                  .setCustomId(`buy_${i}`)
                  .setLabel(`Buy ${item.name}`)
                  .setStyle(ButtonStyle.Success)
          ));

      const sentMessage = await message.reply({ embeds: [storeEmbed], components: [row] });

      const filter = i => i.user.id === message.author.id;
      const collector = sentMessage.createMessageComponentCollector({ filter, time: 300000 }); // 5 min

      collector.on('collect', async interaction => {
          const index = parseInt(interaction.customId.split('_')[1]);
          const item = items[index];
          const userId = interaction.user.id;

          const ud = userData[userId] || { cash: 0, artefacts: [] };

          if (ud.artefacts.includes(item.name)) {
              return interaction.reply({ content: `❌ You already own **${item.name}**!`, flags: [64] });
          }

          if (ud.cash < item.value) {
              return interaction.reply({ content: `💸 You need $${item.value - ud.cash} more to buy **${item.name}**.`, flags: [64] });
          }

          ud.cash -= item.value;
          ud.artefacts.push(item.name);
          userData[userId] = ud;
          saveUserData();

          await interaction.reply({ content: `✅ You bought **${item.name}** for 💰 $${item.value}!`, flags: [64] });

          // Refresh store for all viewers
          const updatedEmbed = EmbedBuilder.from(storeEmbed)
              .setFooter({ text: `Total Items: ${items.length} | Your Balance: $${ud.cash}` });
          await sentMessage.edit({ embeds: [updatedEmbed] });
      });

      collector.on('end', () => {
          sentMessage.edit({ components: [] });
      });
  }

  // !inventory
  if (content === '!inventory') {
      const ud = userData[userId];

      // Artefacts with rarity emojis
      const artefactList = ud.artefacts.length
          ? ud.artefacts.map(name => {
              const rarity = getRarityByArtefact(name);
              const emoji = rarity
                  ? (rarity.name === 'Common' ? '⚪'
                      : rarity.name === 'Uncommon' ? '🟢'
                      : rarity.name === 'Rare' ? '🔵'
                      : rarity.name === 'Legendary' ? '🟡'
                      : '⚫')
                  : '🧰';
              return `${emoji} ${name}`;
          }).join('\n')
          : 'None';

      // Items with quantities and descriptions
      let itemsField = '';
      if (ud.items && ud.items.length > 0) {
          const itemCounts = {};
          ud.items.forEach(item => {
              if (!itemCounts[item.name]) {
                  itemCounts[item.name] = { qty: 0, desc: item.desc || 'No description' };
              }
              itemCounts[item.name].qty++;
          });

          itemsField = Object.entries(itemCounts)
              .map(([name, data]) => `**${name}** — x${data.qty}\n📝 ${data.desc}`)
              .join('\n\n');
      }

      const totalWealth = ud.cash + (ud.bankBalance || 0);

      // Embed
      const embed = new EmbedBuilder()
          .setTitle(`${message.author.username}'s Inventory`)
          .addFields(
              { name: 'Cash on Hand', value: `$${ud.cash.toLocaleString()}`, inline: true },
              { name: 'Bank Balance', value: `$${(ud.bankBalance || 0).toLocaleString()}`, inline: true },
              { name: 'Total Wealth', value: `$${totalWealth.toLocaleString()}`, inline: true },
              { name: 'Artefacts', value: artefactList, inline: false },
          )
          .setColor(0x00AAFF)
          .setFooter({ text: '💡 Tip: Consider putting money in your bank in case of theft.' });

      return message.reply({ embeds: [embed] });
  }

  // !sell
  if (content === '!sell') {
    const arts = userData[userId].artefacts;
    if (!arts.length) return message.reply('You have no artefacts. Use !scavenge to get one!');
    const opts = [...new Set(arts)].map(item=>({ label:item, value:item }));
    const menu = new StringSelectMenuBuilder().setCustomId(`sell_sel_${userId}`).setPlaceholder('Choose artefact to sell').addOptions(opts.slice(0,25));
    const row = new ActionRowBuilder().addComponents(menu);
    await message.reply({ content:'Which artefact would you like to sell?', components:[row] });
  }

  // !trade @user - Enhanced with new UI
  if (content.startsWith('!trade ')) {
    const mentioned = message.mentions.users.first();
    if (!mentioned || mentioned.id === userId) return message.reply('Mention someone to trade with.');

    // Check if either user is already in a trade
    const existingTrade = Object.values(activeTrades).find(
      t => t.status === 'open' && (t.from === userId || t.to === userId || t.from === mentioned.id || t.to === mentioned.id)
    );
    if (existingTrade) return message.reply('❌ One of you is already in an active trade!');

    const tradeId = newTradeId();
    activeTrades[tradeId] = { from: userId, to: mentioned.id, offers: {}, status: 'pending', ready: {} };

    const embed = createTradeRequestEmbed(userId, mentioned.id);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`trade_accept_${tradeId}`)
        .setLabel('Accept Trade')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`trade_decline_${tradeId}`)
        .setLabel('Decline')
        .setEmoji('❌')
        .setStyle(ButtonStyle.Danger)
    );

    await message.channel.send({ embeds: [embed], components: [row] });
  }

  // !gamble-marbles @user1 @user2 @user3 - Squid Game Marble Game
  if (content.startsWith('!gamble-marbles ')) {
    const mentions = message.mentions.users;
    if (mentions.size !== 3) {
      return message.reply('🎯 You must mention exactly 3 other players to start a marble game!\n**Usage:** `!gamble-marbles @user1 @user2 @user3`');
    }

    const players = [userId, ...mentions.keys()];
    const usernames = [message.author.username, ...mentions.map(u => u.username)];

    // Check if any player is already in a marble game
    const existingGame = Object.values(activeMarbleGames).find(game =>
      game.status !== 'finished' && players.some(p => game.players.includes(p))
    );
    if (existingGame) {
      return message.reply('🚫 One or more players are already in an active marble game!');
    }

    const gameId = `marble_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    activeMarbleGames[gameId] = {
      id: gameId,
      initiator: userId,
      players: players,
      usernames: usernames,
      status: 'awaiting_consent',
      consents: { [userId]: true }, // Initiator auto-consents
      channel: message.channel.id,
      createdAt: Date.now()
    };

    const embed = new EmbedBuilder()
      .setTitle('🎲 Marble Gambling Game Invitation')
      .setDescription(`**${message.author.username}** has invited you to play the marble challenge!\n\n**Players:**\n${usernames.map(name => `• ${name}`).join('\n')}\n\n**Rules:**\n• 2 teams of 2 players each\n• Each team starts with 10 marbles\n• Guess numbers 1-20 to win marbles\n• First team to reach 20 marbles wins the bet!`)
      .setColor(0xFF6B6B)
      .setFooter({ text: 'All invited players must accept to proceed' });

    const acceptButton = new ButtonBuilder()
      .setCustomId(`marble_accept_${gameId}`)
      .setLabel('Accept Challenge')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success);

    const declineButton = new ButtonBuilder()
      .setCustomId(`marble_decline_${gameId}`)
      .setLabel('Decline')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder().addComponents(acceptButton, declineButton);

    await message.channel.send({
      content: `${mentions.map(u => `<@${u.id}>`).join(' ')} - You've been challenged to a marble game!`,
      embeds: [embed],
      components: [row]
    });
  }
});
// Enhanced Button and Interaction Logic
  client.on('interactionCreate', async interaction => {
    if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit()) return;
    // Leaderboard pagination
    if (interaction.isButton() && interaction.customId.startsWith('leaderboard_')) {
      const [ , direction, pageStr ] = interaction.customId.split('_');
      const page = parseInt(pageStr, 10);
      const newPage = direction === 'next' ? page + 1 : page - 1;

      await interaction.deferUpdate();
      await interaction.message.delete(); // Remove old page
      showLeaderboardPage(interaction.message, newPage);
    }
    // Modal Builder
    if (interaction.isButton() && interaction.customId.startsWith('trigger_modal_add_item_')) {
      const userId = interaction.customId.split('_').pop();
      if (interaction.user.id !== userId) {
        return interaction.reply({ content: '❌ This button is not for you.', flags: [64] });
      }

      const modal = new ModalBuilder()
        .setCustomId(`modal_add_item_${userId}`)
        .setTitle('📦 Add New Item')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('item_name')
              .setLabel('Item Name')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setPlaceholder('Ex: Sword of Luck')
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('item_value')
              .setLabel('Item Value ($)')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setPlaceholder('Ex: 1000')
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('item_desc')
              .setLabel('Description')
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(false)
              .setPlaceholder('Optional: Describe your item.')
          )
        );

      await interaction.showModal(modal);
    }

    // Handle Marble Game Buttons
    if (interaction.isButton() && (interaction.customId.startsWith('marble_accept_') || interaction.customId.startsWith('marble_decline_'))) {
      const gameId = interaction.customId.substring(interaction.customId.startsWith('marble_accept_') ? 14 : 15); // Extract everything after 'marble_accept_' or 'marble_decline_'
      const game = activeMarbleGames[gameId];

      if (!game) {
        const errorEmbed = new EmbedBuilder()
          .setTitle('❌ Game Not Found')
          .setDescription('This marble game was not found or has already finished.')
          .setColor(0xFF0000);
        return interaction.reply({ embeds: [errorEmbed], flags: [64] });
      }

      const userId = interaction.user.id;
      if (!game.players.includes(userId)) {
        const errorEmbed = new EmbedBuilder()
          .setTitle('❌ Access Denied')
          .setDescription('You are not part of this marble game.')
          .setColor(0xFF0000);
        return interaction.reply({ embeds: [errorEmbed], flags: [64] });
      }

      if (interaction.customId.startsWith('marble_decline_')) {
        const embed = new EmbedBuilder()
          .setTitle('🚫 Marble Game Declined')
          .setDescription(`**${interaction.user.username}** has declined the marble game invitation.`)
          .setColor(0xFF0000);

        await interaction.update({ embeds: [embed], components: [] });
        delete activeMarbleGames[gameId];
        return;
      }

      // Handle accept
      game.consents[userId] = true;
      const totalConsents = Object.keys(game.consents).length;

      if (totalConsents === 4) {
        // All players accepted, move to team formation
        game.status = 'team_formation';
        game.teams = { team1: [], team2: [] };
        game.partnerships = [];

        const embed = new EmbedBuilder()
          .setTitle('✅ All Players Accepted!')
          .setDescription('Now it\'s time to form teams! Each player must choose a partner.\n\n**How it works:**\n• Click "Choose Partner" to select someone\n• That person must accept your partnership\n• Once 2 partnerships are formed, teams are set!')
          .setColor(0x00FF00)
          .addFields({
            name: '👥 Players',
            value: game.usernames.map(name => `• ${name}`).join('\n'),
            inline: true
          });

        const choosePartnerButton = new ButtonBuilder()
          .setCustomId(`marble_choose_partner_${gameId}`)
          .setLabel('Choose Partner')
          .setEmoji('🤝')
          .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(choosePartnerButton);
        await interaction.update({ embeds: [embed], components: [row] });

      } else {
        // Still waiting for more consents
        const embed = new EmbedBuilder()
          .setTitle('⏳ Waiting for Players...')
          .setDescription(`**${interaction.user.username}** has accepted the challenge!\n\n**Status:** ${totalConsents}/4 players ready`)
          .setColor(0xFFD700)
          .addFields({
            name: '✅ Ready Players',
            value: Object.keys(game.consents).map(pid => game.usernames[game.players.indexOf(pid)]).join('\n'),
            inline: true
          }, {
            name: '⏰ Waiting For',
            value: game.players.filter(pid => !game.consents[pid]).map(pid => game.usernames[game.players.indexOf(pid)]).join('\n'),
            inline: true
          });

        await interaction.update({ embeds: [embed], components: interaction.message.components });
      }
    }

    // Handle Partner Selection for Marble Game - SIMPLIFIED VERSION
    if (interaction.isButton() && interaction.customId.startsWith('marble_choose_partner_')) {
      const gameId = interaction.customId.replace('marble_choose_partner_', '');
      const game = activeMarbleGames[gameId];

      console.log(`Choose partner clicked: gameId=${gameId}, game exists=${!!game}`);

      if (!game || game.status !== 'team_formation') {
        const errorEmbed = new EmbedBuilder()
          .setTitle('❌ Game Not Available')
          .setDescription('Game not found or not in team formation phase.')
          .setColor(0xFF0000);
        return interaction.reply({ embeds: [errorEmbed], flags: [64] });
      }

      const userId = interaction.user.id;
      if (!game.players.includes(userId)) {
        const errorEmbed = new EmbedBuilder()
          .setTitle('❌ Access Denied')
          .setDescription('You are not part of this marble game.')
          .setColor(0xFF0000);
        return interaction.reply({ embeds: [errorEmbed], flags: [64] });
      }

      // Initialize partnerships array if not exists
      if (!game.partnerships) game.partnerships = [];

      // Check if user already has a partner
      const existingPartnership = game.partnerships.find(p => p.includes(userId));
      if (existingPartnership) {
        const errorEmbed = new EmbedBuilder()
          .setTitle('❌ Already Partnered')
          .setDescription('You already have a partner for this game!')
          .setColor(0xFF0000);
        return interaction.reply({ embeds: [errorEmbed], flags: [64] });
      }

      // Show partner selection menu with SIMPLE ID format
      const availablePlayers = game.players.filter(pid =>
        pid !== userId && !game.partnerships.some(p => p.includes(pid))
      );

      if (availablePlayers.length === 0) {
        const errorEmbed = new EmbedBuilder()
          .setTitle('❌ No Available Partners')
          .setDescription('All other players are already partnered.')
          .setColor(0xFF0000);
        return interaction.reply({ embeds: [errorEmbed], flags: [64] });
      }

      const options = availablePlayers.map((pid, index) => {
        const username = game.usernames[game.players.indexOf(pid)];
        return {
          label: username,
          value: `PARTNER_${gameId}_${userId}_${pid}`, // Standardized format: PARTNER_gameId_requesterId_partnerId
          description: `Partner with ${username}`,
          emoji: '🤝'
        };
      });

      // Store available players in game temporarily for easy lookup
      game.tempAvailablePlayers = availablePlayers;
      game.tempRequesterId = userId;

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`partner_select_${gameId}`)
        .setPlaceholder('Choose your partner')
        .addOptions(options);

      const selectEmbed = new EmbedBuilder()
        .setTitle('🤝 Choose Your Partner')
        .setDescription('Select a player to partner with for the marble game.')
        .setColor(0x4169E1);

      const row = new ActionRowBuilder().addComponents(selectMenu);
      await interaction.reply({ embeds: [selectEmbed], components: [row], flags: 64 });
    }

    // Handle Partner Selection Menu - Standardized
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('partner_select_')) {
      const gameId = interaction.customId.replace('partner_select_', '');
      const game = activeMarbleGames[gameId];

      if (!game) {
        const errorEmbed = new EmbedBuilder()
          .setTitle('❌ Game Not Found')
          .setDescription('This marble game was not found or has expired.')
          .setColor(0xFF0000);
        return interaction.reply({ embeds: [errorEmbed], flags: [64] });
      }

      const userId = interaction.user.id;
      if (userId !== game.tempRequesterId) {
        const errorEmbed = new EmbedBuilder()
          .setTitle('❌ Access Denied')
          .setDescription('This selection menu is not for you.')
          .setColor(0xFF0000);
        return interaction.reply({ embeds: [errorEmbed], flags: [64] });
      }

      const selectedValue = interaction.values[0]; // Format: PARTNER_gameId_requesterId_partnerId
      console.log(`Selected value: ${selectedValue}`);

      // Split and reconstruct gameId properly (it contains underscores)
      const valueParts = selectedValue.split('_');
      // valueParts: ['PARTNER', 'marble', '1755262160317', '316evo9ve', 'requesterId', 'partnerId']

      if (valueParts.length < 4) {
        console.error('Invalid selected value format:', selectedValue);
        return interaction.reply({ content: '❌ Invalid selection format.', flags: [64] });
      }

      // Get the last two parts as requester and partner IDs
      const requesterId = valueParts[valueParts.length - 2];
      const partnerId = valueParts[valueParts.length - 1];

      console.log(`Parsed IDs - Requester: ${requesterId}, Partner: ${partnerId}`);

      const requesterName = game.usernames[game.players.indexOf(requesterId)];
      const partnerName = game.usernames[game.players.indexOf(partnerId)];

      console.log(`Partnership request: ${requesterName} -> ${partnerName}`);

      // Use simple format for partnership buttons
      const embed = new EmbedBuilder()
        .setTitle('🤝 Partnership Request')
        .setDescription(`**${requesterName}** wants to partner with **${partnerName}** for the marble game!\n\n${partnerName}, do you accept this partnership?`)
        .setColor(0x4169E1)
        .addFields({
          name: '🎯 What happens next?',
          value: '• Accept: You will become teammates\n• Decline: Partnership request is cancelled',
          inline: false
        });

      const acceptButton = new ButtonBuilder()
        .setCustomId(`marble_partnership_accept|${gameId}|${requesterId}|${partnerId}`)
        .setLabel('Accept Partnership')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success);

      const declineButton = new ButtonBuilder()
        .setCustomId(`marble_partnership_decline|${gameId}|${requesterId}|${partnerId}`)
        .setLabel('Decline')
        .setEmoji('❌')
        .setStyle(ButtonStyle.Danger);

      const row = new ActionRowBuilder().addComponents(acceptButton, declineButton);

      await interaction.update({
        content: `<@${partnerId}> - Partnership request!`,
        embeds: [embed],
        components: [row]
      });
    }

    // Handle Partnership Response with pipe delimiter
    if (interaction.isButton() && (interaction.customId.startsWith('marble_partnership_accept|') || interaction.customId.startsWith('marble_partnership_decline|'))) {
      const isAccept = interaction.customId.startsWith('marble_partnership_accept|');
      const parts = interaction.customId.split('|');

      if (parts.length !== 4) {
        console.error('Invalid partnership button format:', interaction.customId);
        const errorEmbed = new EmbedBuilder()
          .setTitle('❌ Invalid Request')
          .setDescription('Invalid partnership request format.')
          .setColor(0xFF0000);
        return interaction.reply({ embeds: [errorEmbed], flags: [64] });
      }

      const gameId = parts[1];
      const requesterId = parts[2];
      const partnerId = parts[3];

      console.log(`Partnership response: ${isAccept ? 'accept' : 'decline'}, gameId: ${gameId}, requester: ${requesterId}, partner: ${partnerId}`);

      const game = activeMarbleGames[gameId];

      if (!game || !game.tempRequesterId || !game.tempAvailablePlayers) {
        const errorEmbed = new EmbedBuilder()
          .setTitle('❌ Game Data Error')
          .setDescription('Game data is missing or invalid. Please restart the game.')
          .setColor(0xFF0000);
        return interaction.reply({ embeds: [errorEmbed], flags: [64] });
      }

      if (interaction.user.id !== partnerId) {
        const errorEmbed = new EmbedBuilder()
          .setTitle('❌ Wrong Recipient')
          .setDescription('This partnership request is not for you.')
          .setColor(0xFF0000);
        return interaction.reply({ embeds: [errorEmbed], flags: [64] });
      }

      // Clear temporary data
      delete game.tempRequesterId;
      delete game.tempAvailablePlayers;

      if (!isAccept) {
        const embed = new EmbedBuilder()
          .setTitle('❌ Partnership Declined')
          .setDescription(`**${game.usernames[game.players.indexOf(partnerId)]}** declined the partnership request from **${game.usernames[game.players.indexOf(requesterId)]}**.`)
          .setColor(0xFF0000);

        await interaction.update({ content: '', embeds: [embed], components: [] });
        return;
      }

      // Accept partnership
      if (!game.partnerships) game.partnerships = [];
      game.partnerships.push([requesterId, partnerId]);

      console.log(`Partnerships after adding: ${game.partnerships.length}`);

      if (game.partnerships.length === 2) {
        // Teams formed, move to betting phase
        game.teams.team1 = game.partnerships[0];
        game.teams.team2 = game.partnerships[1];
        game.status = 'betting';

        const team1Names = game.teams.team1.map(pid => game.usernames[game.players.indexOf(pid)]);
        const team2Names = game.teams.team2.map(pid => game.usernames[game.players.indexOf(pid)]);

        const embed = new EmbedBuilder()
          .setTitle('✅ Teams Formed!')
          .setDescription('Teams have been successfully formed! Now it\'s time to place your bets.\n\n**How betting works:**\n• Both teams must agree on the same bet amount\n• The winning team splits the total pot\n• The losing team loses their bet')
          .setColor(0x00FF00)
          .addFields(
            {
              name: '🔴 Team 1',
              value: team1Names.join(' & '),
              inline: true
            },
            {
              name: '🔵 Team 2',
              value: team2Names.join(' & '),
              inline: true
            }
          );

        const setBetButton = new ButtonBuilder()
          .setCustomId(`marble_set_bet_${gameId}`)
          .setLabel('Set Bet Amount')
          .setEmoji('💰')
          .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(setBetButton);
        await interaction.update({ content: 'Teams are now set!', embeds: [embed], components: [row] });

      } else {
        // One partnership formed, waiting for second
        const partnership1Names = game.partnerships[0].map(pid => game.usernames[game.players.indexOf(pid)]);

        const embed = new EmbedBuilder()
          .setTitle('🤝 Partnership Accepted!')
          .setDescription('First partnership formed! Waiting for the remaining players to partner up.')
          .setColor(0x00AA00)
          .addFields({
            name: '✅ Partnership 1',
            value: partnership1Names.join(' & '),
            inline: false
          });

        const choosePartnerButton = new ButtonBuilder()
          .setCustomId(`marble_choose_partner_${gameId}`)
          .setLabel('Choose Partner')
          .setEmoji('🤝')
          .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(choosePartnerButton);
        await interaction.update({ content: 'First partnership complete!', embeds: [embed], components: [row] });
      }
    }

    // Handle Bet Setting for Marble Game
    if (interaction.isButton() && interaction.customId.startsWith('marble_set_bet_')) {
      const gameId = interaction.customId.split('_')[3];
      const game = activeMarbleGames[gameId];

      if (!game || game.status !== 'betting') {
        const errorEmbed = new EmbedBuilder()
          .setTitle('❌ Betting Not Available')
          .setDescription('Game not found or not in betting phase.')
          .setColor(0xFF0000);
        return interaction.reply({ embeds: [errorEmbed], flags: [64] });
      }

      const userId = interaction.user.id;
      if (!game.players.includes(userId)) {
        const errorEmbed = new EmbedBuilder()
          .setTitle('❌ Access Denied')
          .setDescription('You are not part of this marble game.')
          .setColor(0xFF0000);
        return interaction.reply({ embeds: [errorEmbed], flags: [64] });
      }

      // Show bet amount modal
      const modal = new ModalBuilder()
        .setCustomId(`marble_bet_modal_${gameId}`)
        .setTitle('💰 Set Bet Amount');

      const betInput = new TextInputBuilder()
        .setCustomId('bet_amount')
        .setLabel('Bet Amount ($)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Enter amount to bet (e.g., 1000)')
        .setRequired(true);

      const row = new ActionRowBuilder().addComponents(betInput);
      modal.addComponents(row);

      await interaction.showModal(modal);
    }

    // Handle Bet Amount Modal
    if (interaction.isModalSubmit() && interaction.customId.startsWith('marble_bet_modal_')) {
      const gameId = interaction.customId.split('_')[3];
      const game = activeMarbleGames[gameId];

      if (!game) {
        const errorEmbed = new EmbedBuilder()
          .setTitle('❌ Game Not Found')
          .setDescription('This marble game was not found or has expired.')
          .setColor(0xFF0000);
        return interaction.reply({ embeds: [errorEmbed], flags: [64] });
      }

      const betAmount = parseInt(interaction.fields.getTextInputValue('bet_amount'));
      const userId = interaction.user.id;

      if (isNaN(betAmount) || betAmount <= 0) {
        return interaction.reply({ content: '❌ Please enter a valid positive number.', ephemeral: true });
      }

      // Check if user has enough money
      if (!userData[userId] || userData[userId].cash < betAmount) {
        return interaction.reply({
          content: `❌ You don't have enough money! You have $${userData[userId]?.cash || 0} but tried to bet $${betAmount}.`,
          ephemeral: true
        });
      }

      // Initialize game betting if not exists
      if (!game.bets) game.bets = {};

      game.bets[userId] = betAmount;

      // Check if everyone has placed their bet
      const allBetsPlaced = game.players.every(pid => game.bets[pid] !== undefined);

      if (allBetsPlaced) {
        // Check if all bets are the same
        const betAmounts = Object.values(game.bets);
        const allSame = betAmounts.every(amount => amount === betAmounts[0]);

        if (allSame) {
          // Start the game!
          game.status = 'playing';
          game.currentRound = 1;
          game.marbles = { team1: 10, team2: 10 };
          game.roundGuesses = {};

          // Deduct bet amounts from all players
          game.players.forEach(pid => {
            userData[pid].cash -= game.bets[pid];
          });
          saveUserData();

          // Determine first team randomly
          const firstTeam = Math.random() < 0.5 ? 'team1' : 'team2';
          game.currentTeam = firstTeam;
          game.currentPlayer = game.teams[firstTeam][0]; // First player of the chosen team

          const embed = new EmbedBuilder()
            .setTitle('🎲 Marble Game Started!')
            .setDescription(`**Bet Amount:** $${betAmounts[0]} per player\n**Total Pot:** $${betAmounts[0] * 4}\n\nThe coin toss determined that **${firstTeam === 'team1' ? 'Team 1 🔴' : 'Team 2 🔵'}** goes first!`)
            .setColor(0x00FF00)
            .addFields(
              {
                name: '🔴 Team 1',
                value: `${game.teams.team1.map(pid => game.usernames[game.players.indexOf(pid)]).join(' & ')}\n🟣 Marbles: ${game.marbles.team1}`,
                inline: true
              },
              {
                name: '🔵 Team 2',
                value: `${game.teams.team2.map(pid => game.usernames[game.players.indexOf(pid)]).join(' & ')}\n🟣 Marbles: ${game.marbles.team2}`,
                inline: true
              }
            )
            .setFooter({
              text: `Round ${game.currentRound} • ${game.usernames[game.players.indexOf(game.currentPlayer)]}'s turn`
            });

          const guessButton = new ButtonBuilder()
            .setCustomId(`marble_guess_${gameId}`)
            .setLabel('Make Guess (1-20)')
            .setEmoji('🎯')
            .setStyle(ButtonStyle.Primary);

          const row = new ActionRowBuilder().addComponents(guessButton);

          await interaction.update({
            content: `<@${game.currentPlayer}> - Your turn to guess!`,
            embeds: [embed],
            components: [row]
          });

        } else {
          // Bets don't match
          const embed = new EmbedBuilder()
            .setTitle('❌ Bet Mismatch!')
            .setDescription('All players must bet the same amount. Please try again.')
            .setColor(0xFF0000)
            .addFields(
              game.players.map(pid => ({
                name: game.usernames[game.players.indexOf(pid)],
                value: `$${game.bets[pid]}`,
                inline: true
              }))
            );

          // Reset bets
          game.bets = {};

          const setBetButton = new ButtonBuilder()
            .setCustomId(`marble_set_bet_${gameId}`)
            .setLabel('Set Bet Amount')
            .setEmoji('💰')
            .setStyle(ButtonStyle.Primary);

          const row = new ActionRowBuilder().addComponents(setBetButton);
          await interaction.update({ embeds: [embed], components: [row] });
        }
      } else {
        // Still waiting for more bets
        const pendingPlayers = game.players.filter(pid => game.bets[pid] === undefined);

        const embed = new EmbedBuilder()
          .setTitle('⏳ Waiting for Bets...')
          .setDescription(`**${interaction.user.username}** has bet $${betAmount}!`)
          .setColor(0xFFD700)
          .addFields(
            {
              name: '✅ Bets Placed',
              value: Object.keys(game.bets).map(pid =>
                `${game.usernames[game.players.indexOf(pid)]}: $${game.bets[pid]}`
              ).join('\n'),
              inline: true
            },
            {
              name: '⏰ Waiting For',
              value: pendingPlayers.map(pid => game.usernames[game.players.indexOf(pid)]).join('\n'),
              inline: true
            }
          );

        const setBetButton = new ButtonBuilder()
          .setCustomId(`marble_set_bet_${gameId}`)
          .setLabel('Set Bet Amount')
          .setEmoji('💰')
          .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(setBetButton);
        await interaction.update({ embeds: [embed], components: [row] });
      }
    }

    // Handle Marble Game Guessing
    if (interaction.isButton() && interaction.customId.startsWith('marble_guess_')) {
      const gameId = interaction.customId.split('_')[2];
      const game = activeMarbleGames[gameId];

      if (!game || game.status !== 'playing') {
        return interaction.reply({ content: '❌ Game not found or not in playing phase.', ephemeral: true });
      }

      const userId = interaction.user.id;
      if (userId !== game.currentPlayer) {
        return interaction.reply({ content: '❌ It\'s not your turn to guess!', ephemeral: true });
      }

      // Show guess modal
      const modal = new ModalBuilder()
        .setCustomId(`marble_guess_modal_${gameId}`)
        .setTitle('🎯 Make Your Guess');

      const guessInput = new TextInputBuilder()
        .setCustomId('guess_number')
        .setLabel('Guess a number (1-20)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Enter a number between 1 and 20')
        .setMinLength(1)
        .setMaxLength(2)
        .setRequired(true);

      const row = new ActionRowBuilder().addComponents(guessInput);
      modal.addComponents(row);

      await interaction.showModal(modal);
    }

    // Handle Marble Game Guess Modal
    if (interaction.isModalSubmit() && interaction.customId.startsWith('marble_guess_modal_')) {
      const gameId = interaction.customId.split('_')[3];
      const game = activeMarbleGames[gameId];

      if (!game || game.status !== 'playing') {
        return interaction.reply({ content: '❌ Game not found or not in playing phase.', ephemeral: true });
      }

      const userId = interaction.user.id;
      const guess = parseInt(interaction.fields.getTextInputValue('guess_number'));

      if (isNaN(guess) || guess < 1 || guess > 20) {
        return interaction.reply({ content: '❌ Please enter a number between 1 and 20.', ephemeral: true });
      }

      // Record the guess
      if (!game.roundGuesses) game.roundGuesses = {};
      game.roundGuesses[userId] = guess;

      // Move to next player or check if round is complete
      const currentTeamKey = game.currentTeam;
      const currentTeamPlayers = game.teams[currentTeamKey];
      const currentPlayerIndex = currentTeamPlayers.indexOf(game.currentPlayer);

      if (currentPlayerIndex === 0) {
        // First player of team guessed, move to second player
        game.currentPlayer = currentTeamPlayers[1];

        const embed = new EmbedBuilder()
          .setTitle('🎯 Guess Recorded!')
          .setDescription(`**${game.usernames[game.players.indexOf(userId)]}** has made their guess!`)
          .setColor(0x4169E1)
          .addFields(
            {
              name: '🔴 Team 1',
              value: `${game.teams.team1.map(pid => game.usernames[game.players.indexOf(pid)]).join(' & ')}\n🟣 Marbles: ${game.marbles.team1}`,
              inline: true
            },
            {
              name: '🔵 Team 2',
              value: `${game.teams.team2.map(pid => game.usernames[game.players.indexOf(pid)]).join(' & ')}\n🟣 Marbles: ${game.marbles.team2}`,
              inline: true
            }
          )
          .setFooter({
            text: `Round ${game.currentRound} • ${game.usernames[game.players.indexOf(game.currentPlayer)]}'s turn`
          });

        const guessButton = new ButtonBuilder()
          .setCustomId(`marble_guess_${gameId}`)
          .setLabel('Make Guess (1-20)')
          .setEmoji('🎯')
          .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(guessButton);

        await interaction.update({
          content: `<@${game.currentPlayer}> - Your turn to guess!`,
          embeds: [embed],
          components: [row]
        });

      } else {
        // Second player of team guessed, switch to other team or process round
        const otherTeam = currentTeamKey === 'team1' ? 'team2' : 'team1';
        const otherTeamPlayers = game.teams[otherTeam];

        // Check if other team has also completed their guesses
        const otherTeamGuessed = otherTeamPlayers.every(pid => game.roundGuesses[pid] !== undefined);

        if (otherTeamGuessed) {
          // Both teams have guessed, process the round
          await processMarbleRound(interaction, game, gameId);
        } else {
          // Switch to other team
          game.currentTeam = otherTeam;
          game.currentPlayer = otherTeamPlayers[0];

          const embed = new EmbedBuilder()
            .setTitle('🎯 Guess Recorded!')
            .setDescription(`**${game.usernames[game.players.indexOf(userId)]}** has made their guess!\n\nNow it's the other team's turn!`)
            .setColor(0x4169E1)
            .addFields(
              {
                name: '🔴 Team 1',
                value: `${game.teams.team1.map(pid => game.usernames[game.players.indexOf(pid)]).join(' & ')}\n🟣 Marbles: ${game.marbles.team1}`,
                inline: true
              },
              {
                name: '🔵 Team 2',
                value: `${game.teams.team2.map(pid => game.usernames[game.players.indexOf(pid)]).join(' & ')}\n🟣 Marbles: ${game.marbles.team2}`,
                inline: true
              }
            )
            .setFooter({
              text: `Round ${game.currentRound} • ${game.usernames[game.players.indexOf(game.currentPlayer)]}'s turn`
            });

          const guessButton = new ButtonBuilder()
            .setCustomId(`marble_guess_${gameId}`)
            .setLabel('Make Guess (1-20)')
            .setEmoji('🎯')
            .setStyle(ButtonStyle.Primary);

          const row = new ActionRowBuilder().addComponents(guessButton);

          await interaction.update({
            content: `<@${game.currentPlayer}> - Your turn to guess!`,
            embeds: [embed],
            components: [row]
          });
        }
      }
    }

    // Handle Trade Buttons
    if (interaction.isButton()) {
      const parts = interaction.customId.split('_');
      const action = parts[0];
      if (interaction.customId.startsWith('item_confirm_') || interaction.customId.startsWith('item_cancel_')) {
        const parts = interaction.customId.split('_');
        const userId = parts[2];
        if (interaction.user.id !== userId) {
          return interaction.reply({ content: '❌ This button is not for you.', flags: [64] });
        }

        if (interaction.customId.startsWith('item_confirm_')) {
          const guildId = parts[1];
          const itemName = parts.slice(3).join('_'); // Handle names with underscores
          const item = global.tempItems?.[userId];
          if (!item) return interaction.reply({ content: '❌ No item found to confirm.', ephemeral: true });

          if (!userData.guildItems[guildId]) userData.guildItems[guildId] = [];
          userData.guildItems[guildId].push(item);
          saveUserData();
          delete global.tempItems[userId];

          return interaction.update({
            content: `🎉 Successfully added **${item.name}** to this server's item list.`,
            embeds: [],
            components: []
          });
        }

        if (interaction.customId.startsWith('item_cancel_')) {
          delete global.tempItems[userId];
          return interaction.update({
            content: '❌ Item creation cancelled.',
            embeds: [],
            components: []
          });
        }
      }
      if (action === 'trade') {
        let tradeId, userId, subaction;

        // Parse different button structures
        if (parts[1] === 'accept' || parts[1] === 'decline') {
          // trade_accept_tradeId or trade_decline_tradeId
          subaction = parts[1];
          tradeId = parts[2];
        } else if (parts[1] === 'add') {
          // trade_add_art_tradeId_userId or trade_add_money_tradeId_userId
          subaction = parts[1];
          const subtype = parts[2]; // 'art' or 'money'
          tradeId = parts[3];
          userId = parts[4];
          subaction = `${subaction}_${subtype}`; // becomes 'add_art' or 'add_money'
        } else if (parts[1] === 'ready') {
          // trade_ready_tradeId_userId
          subaction = parts[1];
          tradeId = parts[2];
          userId = parts[3];
        } else if (parts[1] === 'cancel') {
          // trade_cancel_tradeId
          subaction = parts[1];
          tradeId = parts[2];
        }

        const trade = activeTrades[tradeId];
        if (!trade) return interaction.reply({ content: 'Trade not found or expired.', flags: 64 });

        if (subaction === 'accept') {
          if (interaction.user.id !== trade.to) return interaction.reply({ content: 'This trade is not for you.', flags: 64 });

          trade.status = 'open';
          trade.offers = { [trade.from]: { cash: 0, artefacts: [] }, [trade.to]: { cash: 0, artefacts: [] } };
          trade.ready = { [trade.from]: false, [trade.to]: false };

          const fromUser = await interaction.client.users.fetch(trade.from);
          const toUser = await interaction.client.users.fetch(trade.to);

          const embed = createTradeInterfaceEmbed(trade, fromUser.username, toUser.username);
          const controls = createTradeControls(tradeId, interaction.user.id);

          await interaction.update({ embeds: [embed], components: controls });

        } else if (subaction === 'decline') {
          if (interaction.user.id !== trade.to) return interaction.reply({ content: 'This trade is not for you.', flags: 64 });
          delete activeTrades[tradeId];

          const declineEmbed = new EmbedBuilder()
            .setTitle('❌ Trade Declined')
            .setDescription(`<@${trade.to}> has declined the trade request.`)
            .setColor(0xFF0000);

          await interaction.update({ embeds: [declineEmbed], components: [] });

        } else if (subaction === 'add_art') {
          const trade = activeTrades[tradeId];
          if (!trade || trade.status !== 'open') return interaction.reply({ content: 'Trade not active.', ephemeral: true });
          if (trade.from !== interaction.user.id && trade.to !== interaction.user.id) {
            return interaction.reply({ content: 'You are not part of this trade.', flags: 64 });
          }

          const userInventory = userData[interaction.user.id]?.artefacts || [];
          const currentOffer = trade.offers[interaction.user.id]?.artefacts || [];
          const availableArtefacts = userInventory.filter(art => !currentOffer.includes(art));

          if (availableArtefacts.length === 0) {
            return interaction.reply({ content: '❌ You have no available artefacts to add.', flags: 64 });
          }

          const options = availableArtefacts.slice(0, 25).map((art, index) => {
            const rarity = getRarityByArtefact(art);
            const rarityEmoji = rarity ?
              (rarity.name === 'Common' ? '⚪' :
               rarity.name === 'Uncommon' ? '🟢' :
               rarity.name === 'Rare' ? '🔵' :
               rarity.name === 'Legendary' ? '🟡' : '⚫') : '❓';

            return {
              label: `${art} (${rarity ? rarity.name : 'Unknown'})`,
              value: `${art}_${index}`,  // 👈 Ensure uniqueness
              emoji: rarityEmoji,
              description: `Value: $${rarity ? rarity.value.toLocaleString() : '???'}`
            };
          });

          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`select_trade_art_${tradeId}_${interaction.user.id}`)
            .setPlaceholder('🎒 Choose an artefact to add')
            .addOptions(options);

          const row = new ActionRowBuilder().addComponents(selectMenu);
          await interaction.reply({ content: '✨ Select an artefact from your inventory:', components: [row], flags: 64 });

        } else if (subaction === 'add_money') {
          const modal = new ModalBuilder()
            .setCustomId(`trade_money_modal_${tradeId}_${interaction.user.id}`)
            .setTitle('💰 Add Money to Trade');

          const amountInput = new TextInputBuilder()
            .setCustomId('money_amount')
            .setLabel('Amount to add ($)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Enter amount (e.g. 1000)')
            .setRequired(true);

          const firstRow = new ActionRowBuilder().addComponents(amountInput);
          modal.addComponents(firstRow);

          await interaction.showModal(modal);

        } else if (subaction === 'ready') {
          const trade = activeTrades[tradeId];
          if (!trade || trade.status !== 'open') return interaction.reply({ content: 'Trade not active.', flags: 64 });
          if (trade.from !== interaction.user.id && trade.to !== interaction.user.id) {
            return interaction.reply({ content: 'You are not part of this trade.', flags: 64 });
          }

          trade.ready[interaction.user.id] = !trade.ready[interaction.user.id];

          if (trade.ready[trade.from] && trade.ready[trade.to]) {
            // Execute trade
            const fromOffer = trade.offers[trade.from] || { cash: 0, artefacts: [] };
            const toOffer = trade.offers[trade.to] || { cash: 0, artefacts: [] };

            // Transfer artefacts and money
            fromOffer.artefacts.forEach(art => {
              const idx = userData[trade.from].artefacts.indexOf(art);
              if (idx > -1) userData[trade.from].artefacts.splice(idx, 1);
              userData[trade.to].artefacts.push(art);
            });

            toOffer.artefacts.forEach(art => {
              const idx = userData[trade.to].artefacts.indexOf(art);
              if (idx > -1) userData[trade.to].artefacts.splice(idx, 1);
              userData[trade.from].artefacts.push(art);
            });

            userData[trade.from].cash += toOffer.cash;
            userData[trade.to].cash += fromOffer.cash;

            saveUserData();
            delete activeTrades[tradeId];

            const successEmbed = new EmbedBuilder()
              .setTitle('🎉 Trade Completed Successfully!')
              .setDescription(`✅ **<@${trade.from}>** and **<@${trade.to}>** have completed their trade!`)
              .addFields(
                {
                  name: '📦 Items Exchanged',
                  value: `**Artefacts:** ${[...fromOffer.artefacts, ...toOffer.artefacts].join(', ') || 'None'}\n**Money:** $${(fromOffer.cash + toOffer.cash).toLocaleString()}`,
                  inline: false
                }
              )
              .setColor(0x00FF00)
              .setThumbnail('https://cdn.discordapp.com/emojis/741713906411708517.png');

            await interaction.update({ embeds: [successEmbed], components: [] });
          } else {
            // Update interface
            const fromUser = await interaction.client.users.fetch(trade.from);
            const toUser = await interaction.client.users.fetch(trade.to);
            const embed = createTradeInterfaceEmbed(trade, fromUser.username, toUser.username);
            const controls = createTradeControls(tradeId, interaction.user.id, trade.ready?.[interaction.user.id]);

            await interaction.update({ embeds: [embed], components: controls });
          }

        } else if (subaction === 'cancel') {
          const trade = activeTrades[tradeId];
          if (!trade) return interaction.reply({ content: 'Trade not found.', flags: 64 });

          // Return any offered money
          if (trade.offers[trade.from]?.cash) userData[trade.from].cash += trade.offers[trade.from].cash;
          if (trade.offers[trade.to]?.cash) userData[trade.to].cash += trade.offers[trade.to].cash;
          saveUserData();

          delete activeTrades[tradeId];

          const cancelEmbed = new EmbedBuilder()
            .setTitle('❌ Trade Cancelled')
            .setDescription('The trade has been cancelled. Any offered money has been returned.')
            .setColor(0xFF0000);

          await interaction.update({ embeds: [cancelEmbed], components: [] });
        }
      }

      // Handle sell buttons
      if (interaction.customId.startsWith('sell_')) {
        const parts = interaction.customId.split('_');
        const userId = parts[2];
        const selArt = parts[3];

        if (interaction.user.id !== userId) return interaction.reply({ content: 'This is not your transaction.', ephemeral: true });

        if (parts[1] === 'yes') {
          const rar = getRarityByArtefact(selArt);
          const price = rar ? rar.sell : 0;
          const idx = userData[userId].artefacts.indexOf(selArt);
          if (idx > -1) userData[userId].artefacts.splice(idx, 1);
          userData[userId].cash += price;
          saveUserData();

          const successEmbed = new EmbedBuilder()
            .setTitle('✅ Sale Completed!')
            .setDescription(`You successfully sold **${selArt}** for **$${price.toLocaleString()}**!`)
            .addFields(
              { name: '💰 Current Cash', value: `$${userData[userId].cash.toLocaleString()}`, inline: true }
            )
            .setColor(0x00FF00);

          await interaction.update({ content: null, embeds: [successEmbed], components: [] });
        } else {
          const cancelEmbed = new EmbedBuilder()
            .setTitle('❌ Sale Cancelled')
            .setDescription('You cancelled the transaction.')
            .setColor(0xFF0000);

          await interaction.update({ content: null, embeds: [cancelEmbed], components: [] });
        }
      }
    }

    // Handle Select Menus
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith('select_trade_art_')) {
        const [, , , tradeId, userId] = interaction.customId.split('_');
        if (interaction.user.id !== userId) return interaction.reply({ content: 'Not your selection.', flags: 64 });

        const trade = activeTrades[tradeId];
        if (!trade || trade.status !== 'open') return interaction.reply({ content: 'Trade not active.', flags: 64 });

        const selectedArtefact = interaction.values[0].split('_')[0];

        if (!trade.offers[userId]) trade.offers[userId] = { cash: 0, artefacts: [] };
        trade.offers[userId].artefacts.push(selectedArtefact);

        const rarity = getRarityByArtefact(selectedArtefact);
        const rarityEmoji = rarity ?
          (rarity.name === 'Common' ? '⚪' :
           rarity.name === 'Uncommon' ? '🟢' :
           rarity.name === 'Rare' ? '🔵' :
           rarity.name === 'Legendary' ? '🟡' : '⚫') : '❓';

        await interaction.reply({ content: `✅ Added ${rarityEmoji} **${selectedArtefact}** to your trade offer!`, flags: 64 });

        // Update main trade interface
        const fromUser = await interaction.client.users.fetch(trade.from);
        const toUser = await interaction.client.users.fetch(trade.to);
        const embed = createTradeInterfaceEmbed(trade, fromUser.username, toUser.username);
        const controls = createTradeControls(tradeId, userId, trade.ready?.[userId]);

        const originalMessage = await interaction.channel.messages.fetch(interaction.message.reference?.messageId || interaction.message.id);
        await originalMessage.edit({ embeds: [embed], components: controls });
      }

      // Handle sell menu
      if (interaction.customId.startsWith('sell_sel_')) {
        const userId = interaction.customId.split('_')[2];
        if (interaction.user.id !== userId) return interaction.reply({ content: 'This is not your selection.', ephemeral: true });

        const selArt = interaction.values[0];
        const rar = getRarityByArtefact(selArt);
        const price = rar ? rar.sell : 0;

        const rarityEmoji = rar ?
          (rar.name === 'Common' ? '⚪' :
           rar.name === 'Uncommon' ? '🟢' :
           rar.name === 'Rare' ? '🔵' :
           rar.name === 'Legendary' ? '🟡' : '⚫') : '❓';

        const confirmEmbed = new EmbedBuilder()
          .setTitle('💰 Confirm Sale')
          .setDescription(`${rarityEmoji} **${selArt}** - ${rar ? rar.name : 'Unknown'} Rarity`)
          .addFields(
            { name: '💵 Sale Price', value: `$${price.toLocaleString()}`, inline: true },
            { name: '💼 Current Cash', value: `$${userData[userId].cash.toLocaleString()}`, inline: true },
            { name: '📈 New Total', value: `$${(userData[userId].cash + price).toLocaleString()}`, inline: true }
          )
          .setColor(rar ? rar.color : 0xAAAAAA)
          .setFooter({ text: 'This action cannot be undone!' });

        const confirmRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`sell_yes_${userId}_${selArt}`).setLabel('Confirm Sale').setStyle(ButtonStyle.Success).setEmoji('✅'),
          new ButtonBuilder().setCustomId(`sell_no_${userId}_${selArt}`).setLabel('Cancel').setStyle(ButtonStyle.Danger).setEmoji('❌')
        );

        await interaction.update({ content: null, embeds: [confirmEmbed], components: [confirmRow] });
      }
    }

    // Handle Modal Submissions
    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('modal_add_item_')) {
        const userId = interaction.user.id;
        const guildId = interaction.guildId;
        const itemName = interaction.fields.getTextInputValue('item_name').trim();
        const itemValue = parseInt(interaction.fields.getTextInputValue('item_value'), 10);
        const itemDesc = interaction.fields.getTextInputValue('item_desc') || 'No description.';

        if (!itemName || isNaN(itemValue)) {
          return interaction.reply({ content: '❌ Invalid input. Name must be text and value must be a number.', ephemeral: true });
        }

        const itemPreview = new EmbedBuilder()
          .setTitle('📦 Confirm New Item')
          .addFields(
            { name: '🧾 Name', value: itemName },
            { name: '💰 Value', value: `$${itemValue}` },
            { name: '🖊 Description', value: itemDesc }
          )
          .setColor(0x00AAFF)
          .setFooter({ text: 'Confirm or cancel below' });

        const confirmRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`item_confirm_${guildId}_${userId}_${itemName}`).setLabel('✅ Confirm').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`item_cancel_${userId}`).setLabel('❌ Cancel').setStyle(ButtonStyle.Danger)
        );

        await interaction.reply({ embeds: [itemPreview], components: [confirmRow], ephemeral: true });

        global.tempItems[userId] = { name: itemName, value: itemValue, desc: itemDesc };
      }
      if (interaction.customId.startsWith('trade_money_modal_')) {
        const [, , , tradeId, userId] = interaction.customId.split('_');
        if (interaction.user.id !== userId) return interaction.reply({ content: 'Not your modal.', flags: 64 });

        const trade = activeTrades[tradeId];
        if (!trade || trade.status !== 'open') return interaction.reply({ content: 'Trade not active.', flags: 64 });

        const amount = parseInt(interaction.fields.getTextInputValue('money_amount'), 10);
        if (isNaN(amount) || amount <= 0) return interaction.reply({ content: '❌ Please enter a valid amount.', flags: 64 });
        if (userData[userId].cash < amount) return interaction.reply({ content: '❌ You do not have enough money.', flags: 64 });

        if (!trade.offers[userId]) trade.offers[userId] = { cash: 0, artefacts: [] };
        trade.offers[userId].cash += amount;
        userData[userId].cash -= amount;
        saveUserData();

        await interaction.reply({ content: `✅ Added 💰 **$${amount.toLocaleString()}** to your trade offer!`, flags: 64 });

        // Update main trade interface
        const fromUser = await interaction.client.users.fetch(trade.from);
        const toUser = await interaction.client.users.fetch(trade.to);
        const embed = createTradeInterfaceEmbed(trade, fromUser.username, toUser.username);
        const controls = createTradeControls(tradeId, userId, trade.ready?.[userId]);

        const channel = interaction.channel;
        const messages = await channel.messages.fetch({ limit: 50 });
        const tradeMessage = messages.find(msg =>
          msg.embeds.length > 0 &&
          msg.embeds[0].title === '🏪 Interactive Trading Interface'
        );

        if (tradeMessage) {
          await tradeMessage.edit({ embeds: [embed], components: controls });
        }
      }
    }
  });

// Process Marble Game Round Function
async function processMarbleRound(interaction, game, gameId) {
  // Roll the dice
  let rolledNumber;
  let attempts = 0;
  const maxAttempts = 10; // Safety limit to prevent infinite loops

  do {
    rolledNumber = Math.floor(Math.random() * 20) + 1;
    attempts++;

    // Check if anyone guessed this number
    const winners = game.players.filter(pid => game.roundGuesses[pid] === rolledNumber);

    if (winners.length > 0) {
      // Someone won this round!
      const winnerTeam = game.teams.team1.includes(winners[0]) ? 'team1' : 'team2';
      const loserTeam = winnerTeam === 'team1' ? 'team2' : 'team1';

      // Transfer marble
      game.marbles[winnerTeam] += 1;
      game.marbles[loserTeam] -= 1;

      const winnerNames = winners.map(pid => game.usernames[game.players.indexOf(pid)]);

      // Check for game end
      if (game.marbles[winnerTeam] >= 20) {
        // Game over! This team wins
        game.status = 'finished';
        const totalPot = Object.values(game.bets).reduce((sum, bet) => sum + bet, 0);
        const winningsPerPlayer = totalPot / 2; // Split between 2 winners

        // Award winnings to winning team
        game.teams[winnerTeam].forEach(pid => {
          userData[pid].cash += winningsPerPlayer;
        });
        saveUserData();

        const finalEmbed = new EmbedBuilder()
          .setTitle('🎉 GAME OVER!')
          .setDescription(`**${winnerTeam === 'team1' ? 'Team 1 🔴' : 'Team 2 🔵'}** has won the marble game!\n\n**Final Roll:** ${rolledNumber}\n**Winning Guess:** ${winners.map(pid => `${game.usernames[game.players.indexOf(pid)]} (${game.roundGuesses[pid]})`).join(', ')}`)
          .setColor(0xFFD700)
          .addFields(
            {
              name: '🏆 Winners',
              value: game.teams[winnerTeam].map(pid => game.usernames[game.players.indexOf(pid)]).join(' & '),
              inline: true
            },
            {
              name: '💰 Winnings',
              value: `$${winningsPerPlayer.toLocaleString()} each`,
              inline: true
            },
            {
              name: '📊 Final Score',
              value: `🔴 Team 1: ${game.marbles.team1} marbles\n🔵 Team 2: ${game.marbles.team2} marbles`,
              inline: false
            }
          )
          .setFooter({ text: `Game completed after ${game.currentRound} rounds` });

        await interaction.update({
          content: '🎊 Congratulations to the winners!',
          embeds: [finalEmbed],
          components: []
        });

        // Clean up the game
        delete activeMarbleGames[gameId];
        return;
      }

      // Continue game - prepare next round
      game.currentRound++;
      game.roundGuesses = {};

      // Switch starting team for next round
      const nextStartingTeam = winnerTeam === 'team1' ? 'team2' : 'team1';
      game.currentTeam = nextStartingTeam;
      game.currentPlayer = game.teams[nextStartingTeam][0];

      const roundEmbed = new EmbedBuilder()
        .setTitle(`🎯 Round ${game.currentRound - 1} Results`)
        .setDescription(`**Rolled Number:** ${rolledNumber}\n**Winner:** ${winnerNames.join(' & ')} guessed correctly!\n\n${winnerTeam === 'team1' ? 'Team 1 🔴' : 'Team 2 🔵'} gains 1 marble!`)
        .setColor(winnerTeam === 'team1' ? 0xFF0000 : 0x0000FF)
        .addFields(
          {
            name: '🔴 Team 1',
            value: `${game.teams.team1.map(pid => game.usernames[game.players.indexOf(pid)]).join(' & ')}\n🟣 Marbles: ${game.marbles.team1}`,
            inline: true
          },
          {
            name: '🔵 Team 2',
            value: `${game.teams.team2.map(pid => game.usernames[game.players.indexOf(pid)]).join(' & ')}\n🟣 Marbles: ${game.marbles.team2}`,
            inline: true
          }
        )
        .setFooter({
          text: `Round ${game.currentRound} starting • ${game.usernames[game.players.indexOf(game.currentPlayer)]}'s turn`
        });

      const guessButton = new ButtonBuilder()
        .setCustomId(`marble_guess_${gameId}`)
        .setLabel('Make Guess (1-20)')
        .setEmoji('🎯')
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder().addComponents(guessButton);

      // Add 3 second delay before next round
      await interaction.update({
        content: 'Processing next round in 3 seconds...',
        embeds: [roundEmbed],
        components: []
      });

      setTimeout(async () => {
        await interaction.editReply({
          content: `<@${game.currentPlayer}> - Your turn to guess!`,
          embeds: [roundEmbed],
          components: [row]
        });
      }, 3000);

      return; // Exit the function as we found winners
    }
  } while (attempts < maxAttempts);

  // If we get here, no one guessed the number after max attempts
  // This is a backup - in practice, this should rarely happen
  const noWinnerEmbed = new EmbedBuilder()
    .setTitle('🔄 No Winners This Round')
    .setDescription(`After ${maxAttempts} attempts, no winning numbers were rolled. Starting next round...`)
    .setColor(0xFFFF00);

  await interaction.update({ embeds: [noWinnerEmbed], components: [] });

  // Reset round and continue
  game.roundGuesses = {};
  game.currentPlayer = game.teams[game.currentTeam][0];

  setTimeout(async () => {
    const guessButton = new ButtonBuilder()
      .setCustomId(`marble_guess_${gameId}`)
      .setLabel('Make Guess (1-20)')
      .setEmoji('🎯')
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(guessButton);

    await interaction.editReply({
      content: `<@${game.currentPlayer}> - Your turn to guess!`,
      components: [row]
    });
  }, 2000);
}

client.login(token);
