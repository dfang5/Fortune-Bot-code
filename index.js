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

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const DATA_FILE = path.join(__dirname, 'data.json');
const COOLDOWN_FILE = path.join(__dirname, 'cooldowns.json');

// Load persistent data
let userData = fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE)) : {};
let cooldowns = fs.existsSync(COOLDOWN_FILE) ? JSON.parse(fs.readFileSync(COOLDOWN_FILE)) : { scavenge: {}, labor: {} };

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

client.once('ready', () => console.log(`Fortune Bot online as ${client.user.tag}`));

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
          '`!inventory` - View your cash and artefacts',
          '`!sell` - Sell your artefacts for cash',
          '`!trade @user` - Start a trade with another user'
        ].join('\n'),
        inline: false
      },
      {
        name: '💰 Trading System',
        value: [
          '`!add artefact` - Add artefacts to active trade',
          '`!add money <amount>` - Add cash to active trade'
        ].join('\n'),
        inline: false
      },
      {
        name: '🏆 Rarity Levels',
        value: [
          '⚪ **Common** (65%) - $100-150',
          '🟢 **Uncommon** (20%) - $550-700', 
          '🔵 **Rare** (10%) - $1,500-2,500',
          '🟡 **Legendary** (4%) - $10,000',
          '⚫ **Unknown** (1%) - $1,000,000'
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

// Cooldowns
const SCAVENGE_COOLDOWN = 2 * 60 * 60 * 1000;
const LABOR_COOLDOWN = 40 * 60 * 1000;

// Enhanced Trade UI Functions
function createTradeRequestEmbed(fromUser, toUser) {
  return new EmbedBuilder()
    .setTitle('🤝 Trade Request')
    .setDescription(`✨ **<@${fromUser}>** wants to start a trading session with **<@${toUser}>**!\n\n🎯 Ready to exchange valuable artefacts and fortune?`)
    .addFields(
      {
        name: '🎮 What happens next?',
        value: '• Accept to enter the interactive trading interface\n• Decline to politely refuse this trade',
        inline: false
      },
      {
        name: '💡 Trading Tips',
        value: '• Both parties can add artefacts and money\n• Review everything before confirming\n• Trades are secure and instant',
        inline: false
      }
    )
    .setColor(0x7289DA)
    .setThumbnail('https://cdn.discordapp.com/emojis/741713906411708517.png')
    .setFooter({ text: 'Trade expires in 60 seconds' })
    .setTimestamp();
}

function createTradeInterfaceEmbed(trade, fromUserName, toUserName) {
  const fromUser = trade.from;
  const toUser = trade.to;
  const fromOffer = trade.offers[fromUser] || { cash: 0, artefacts: [] };
  const toOffer = trade.offers[toUser] || { cash: 0, artefacts: [] };

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
    .setTitle('🏪 Interactive Trading Interface')
    .setDescription(`💫 **Live Trade Session Active**\n\n🔄 Use the buttons below to manage your offers!`)
    .addFields(
      {
        name: `👤 ${fromUserName}'s Offer`,
        value: `**Artefacts:**\n${fromArtefacts}\n\n💰 **Cash:** $${(fromOffer.cash || 0).toLocaleString()}\n📊 **Total Value:** ~$${totalFromValue.toLocaleString()}`,
        inline: true
      },
      {
        name: '⚖️ VS',
        value: '```\n  ⚡\n /||\\\n  ||\n  💎\n```',
        inline: true
      },
      {
        name: `👤 ${toUserName}'s Offer`,
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

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  const userId = message.author.id;
  const content = message.content.toLowerCase();

  if (!userData[userId]) userData[userId] = { cash:0, artefacts:[] };

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
  //!leaderboard (or !lb):
  
  // !inventory
  if (content === '!inventory') {
    const ud = userData[userId];
    const artefactList = ud.artefacts.length ? ud.artefacts.join(', ') : 'None';
    const embed = new EmbedBuilder()
      .setTitle(`${message.author.username}'s Inventory`)
      .addFields(
        { name:'💰 Cash', value:`$${ud.cash}`, inline:true },
        { name:'📦 Artefacts', value:artefactList, inline:false }
      ).setColor(0x00AAFF);
    return message.reply({ embeds:[embed] });
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

  // Remove old !add commands since they're now handled by buttons
});

// Enhanced Button and Interaction Logic
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit()) return;

  // Handle Trade Buttons
  if (interaction.isButton()) {
    const parts = interaction.customId.split('_');
    const action = parts[0];

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
          const controls = createTradeControls(tradeId, interaction.user.id, trade.ready[interaction.user.id]);

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

client.login(token);
