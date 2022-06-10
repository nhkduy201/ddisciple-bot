import runServer from './server.js'
import usm from './user-send-message.js'
import Queue from './queue.js'
import got from 'got'
import sotClient from 'soundoftext-js'
import { Client, Intents, MessageEmbed } from 'discord.js'
import { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } from '@discordjs/voice'
import dotenv from 'dotenv'
import ytdl from 'ytdl-core'
dotenv.config()
const client = new Client({
  intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES,
     Intents.FLAGS.GUILD_MESSAGE_REACTIONS, Intents.FLAGS.GUILD_VOICE_STATES],
  partials: ['MESSAGE', 'CHANNEL', 'REACTION']
})
let myUsm = usm.setToken(process.env.MY_TOKEN)
let player = createAudioPlayer()
let resource
let connection
let playMessage
let preVolume = 1
let queue = new Queue()

player.on('error',(err) => {
  client.channels.cache.get(process.env.ERROR_CHANNEL_ID).send(err.message)
})

player.on(AudioPlayerStatus.Idle, (oldState, newState) => {
  resource = undefined
  play()
})

const play = () => {
  if(player.state.status === AudioPlayerStatus.Idle && !queue.isEmpty) {
    resource = createAudioResource(queue.dequeue(), { inlineVolume: true })
    player.play(resource)
  }
}

const initConnection = () => {
  connection = joinVoiceChannel({
    channelId: process.env.VOICE_CHANNEL_ID,
    guildId: process.env.SERVER_ID,
    adapterCreator: client.channels.cache.get(process.env.VOICE_CHANNEL_ID).guild.voiceAdapterCreator,
  })
  connection.subscribe(player)
}

const sendInValid = (message) => message.channel.send('Invalid command!')

const volumeControl = (reaction, user) => {
  if (resource && resource.started && !resource.ended && playMessage
    && user.id != client.user.id && reaction.message.id === playMessage.id) {
    if (reaction.emoji.name === '🔊') {
      if(resource.volume.volume + 0.25 <= 1) {
        resource.volume.volume += 0.25
        preVolume = null
      }
    }
    if (reaction.emoji.name === '🔉') {
      if(resource.volume.volume - 0.25 >= 0) {
        resource.volume.volume -= 0.25
        preVolume = null
      }
    }
    if (reaction.emoji.name === '🔇') {
      if (resource.volume.volume == 0) {
          resource.volume.volume = preVolume || 0.25
      } else {
        preVolume = resource.volume.volume
        resource.volume.volume = 0
      }
    }
  }
}

const sendPlayInfo = (message, embed) => {
  message.channel.send(embed).then(afterMess => {
    playMessage = afterMess
    playMessage.react('🔊')
    playMessage.react('🔉')
    playMessage.react('🔇')
  })
}

const handlePlayMp3 = (message, playPara) => {
  sendPlayInfo(playPara.substring(message, playPara.lastIndexOf('/') + 1))
  queue.enqueue(got.stream(playPara))
}

const handleSpeak = async (message, playPara) => {
  playPara = playPara.replace(new RegExp(process.env.SECRET_1, 'g'), decodeURI(process.env.SECRET_2))
  .replace(new RegExp(process.env.SECRET_3, 'g'), decodeURI(process.env.SECRET_4))
  sendPlayInfo(message, 'Speaking...')
  let urlPromises = []
  let i = 0
  let j
  while(true) {
    j = i + 200
    if(j >= playPara.length) {
      urlPromises.push(sotClient.sounds.create({ text: playPara.substring(i), voice: 'vi-VN' }))
      break
    }
    j = playPara.lastIndexOf(' ', j)
    if(j == -1) {
      j = playPara.length
      continue
    }
    urlPromises.push(sotClient.sounds.create({ text: playPara.substring(i, j), voice: 'vi-VN' }))
    i = j + 1
  }
  Promise.all(urlPromises).then(urls => {
    for(const url of urls) {
      queue.enqueue(got.stream(url))
    }
    play()
  })
}

const cleanCmdParas = message => message.content.replace(/\s\s+/g, ' ').split(' ').splice(1).join(' ').trim()

const checkCmd = (message, cmd) => message.content.startsWith(cmd + ' ') || message.content == cmd

const bulkDelete = channelId => setInterval(() => client.channels.cache.get(channelId).bulkDelete(100), 2000)

client.on('ready', () => {
  console.log('client is ready')
})
  .on('messageReactionAdd', volumeControl).on('messageReactionRemove', volumeControl)
  .on('messageCreate', async message => {
      if (checkCmd(message, '$$pl')) {
        let plPara = cleanCmdParas(message)
        if(!plPara.length) {
          sendInValid(message)
          return
        }
        if (!connection || connection.state.status === 'destroyed') {
          initConnection()
        }
        got(`https://www.youtube.com/results?search_query=${plPara.replaceAll(' ', '+')}`).then(res => {
          const firPnt = "\"videoRenderer\""
          const secPnt = ",\"longBylineText"
          const start = res.body.indexOf(firPnt) + firPnt.length + 1;
          const end = res.body.indexOf(secPnt, res.body.indexOf(firPnt))
          const data = JSON.parse(res.body.substring(start, end) + '}')
          const vidUrl = `https://www.youtube.com/watch?v=${data.videoId}`
          let plEmbed = new MessageEmbed()
          plEmbed.setDescription(`**[${data.title.runs ? data.title.runs[0].text :data.title.simpleText}](${vidUrl})**`)
          plEmbed.setImage(data.thumbnail.thumbnails.find(thum => thum.width = '720').url
          || data.thumbnail.thumbnails[0].url)
          sendPlayInfo(message, {embeds: [plEmbed]})
          queue.enqueue(ytdl(`${vidUrl}`, {quality: "lowestaudio",filter: 'audioonly'}))
          play()
        })
      }
      if (checkCmd(message, '$mp3')) {
        let mp3Para = cleanCmdParas(message)
        if(!mp3Para.length) {
          sendInValid(message)
          return
        }
        if (!connection || connection.state.status === 'destroyed') {
          initConnection()
        }
        if(mp3Para.startsWith('http') && mp3Para.endsWith('.mp3'))
          handlePlayMp3(message, mp3Para)
        else
          sendInValid(message)
        play()
      }
      if (checkCmd(message, '$spk')) {
        let spkPara = cleanCmdParas(message)
        if(!spkPara.length) {
          sendInValid(message)
          return
        }
        if (!connection || connection.state.status === 'destroyed') {
          initConnection()
        }
        await handleSpeak(message, spkPara)
        play()
      }
      if(checkCmd(message, '$skp')) {
        player.stop()
        play()
      }
      if (checkCmd(message, '$pau')) 
        player.pause()
      if (checkCmd(message, '$res'))
        player.unpause()
      if (checkCmd(message, '$stp')) {
        player.stop()
        if (connection) connection.destroy()
      }
      if (checkCmd(message, '$help')) {
        const helpEmbed = new MessageEmbed()
        helpEmbed.setDescription(`
        $pl ***keyword***: search youtube and play
        $mp3 ***url***: play mp3 from ***url***
        $spk ***paragraph***: speak it for you
        $skp: skip
        $pau: pause
        $res: resume
        $stp: bot leave
        `)
        message.channel.send({embeds: [helpEmbed]})
      }
  })
  .login(process.env.BOT_TOKEN)

runServer()