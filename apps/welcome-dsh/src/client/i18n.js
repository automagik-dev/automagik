// The team step's copy follows the DSH language. Keys are the English text; welcome.team is
// registered in English and in Brazilian Portuguese, and a key with no text in the active
// language reads in English. Copy is looked up at render time, so nothing caches a translated
// string. The rest of the welcome is English only.

export const NAMESPACE = 'welcome.team'

export const PT_BR = {
  // Installs and their errors
  'The install was cancelled.': 'A instalação foi cancelada.',
  'Omni\'s installer stopped (exit code {code}). What it printed is above.': 'O instalador do Omni parou (código de saída {code}). A saída está acima.',

  // A found Omni, and where Omni comes from
  'Your Omni on this Mac': 'Seu Omni neste Mac',
  'Your Omni on this computer': 'Seu Omni neste computador',
  'Omni on this Mac': 'Omni neste Mac',
  'Omni on this computer': 'Omni neste computador',
  'port {port}': 'porta {port}',
  'saved in your Omni CLI': 'salvo na sua CLI do Omni',
  'Not answering right now.': 'Não está respondendo agora.',
  'Needs an update first; Connect Omni, next, does it.': 'Precisa de uma atualização antes; Connect Omni, o próximo passo, cuida disso.',
  'Sign-in from devices is off on it.': 'O login por dispositivos está desligado nesse Omni.',
  'Channel': 'Canal',
  'Use {omni}': 'Usar {omni}',
  'Connect {omni}': 'Conectar {omni}',
  'Already on this Mac': 'Já está neste Mac',
  'Already on this computer': 'Já está neste computador',
  'Saved in your Omni CLI': 'Salvo na sua CLI do Omni',
  'Run Omni on this Mac': 'Rodar o Omni neste Mac',
  'Run Omni on this computer': 'Rodar o Omni neste computador',
  'A private Omni of its own, set up for you': 'Um Omni privado, só seu, configurado para você',
  'An Omni somewhere else': 'Um Omni em outro lugar',
  'On a server, or the link Omni sent you': 'Em um servidor, ou o link que o Omni enviou para você',
  'Where your Omni is': 'Onde está seu Omni',
  'Connecting…': 'Conectando…',
  'Where is your Omni?': 'Onde está seu Omni?',
  'Connect': 'Conectar',
  'That link is cut short. Copy the whole link Omni sent you.': 'Esse link está cortado. Copie o link inteiro que o Omni enviou.',
  'Its claim link: Omni opens it in your browser to make it yours.': 'É o link de reivindicação: o Omni abre no seu navegador para que passe a ser seu.',
  'Its address, or paste the link Omni sent you on WhatsApp.': 'O endereço, ou cole o link que o Omni enviou no WhatsApp.',
  'Back to the choices': 'Voltar às opções',

  // An Omni nobody owns yet, and a sign-in from the phone
  '{host} has no owner yet': '{host} ainda não pertence a ninguém',
  'Make it yours on its server, then paste the link it prints below:': 'Torne esse Omni seu no servidor e cole abaixo o link que aparecer:',
  'Copied': 'Copiado',
  'Copy': 'Copiar',
  'Or {link}, click Claim this Omni, then connect its address again.': 'Ou {link}, clique em Claim this Omni e conecte o endereço de novo.',
  'open its claim page': 'abra a página de reivindicação',
  'Or open the claim link from its server log in your browser, then connect its address again.': 'Ou abra no navegador o link de reivindicação do log do servidor e conecte o endereço de novo.',
  'The link it printed': 'O link que apareceu',
  'Open WhatsApp': 'Abrir o WhatsApp',
  'Approve': 'Aprovar',
  'Cancel': 'Cancelar',
  'No WhatsApp on that Omni? Run {command} on its server.': 'Sem WhatsApp nesse Omni? Rode {command} no servidor desse Omni.',
  'That Omni cannot approve this app from here. Connect Omni, next, can use its API key.': 'Esse Omni não consegue aprovar este app daqui. Connect Omni, o próximo passo, pode usar a chave de API.',
  'The sign-in was denied.': 'O login foi negado.',
  'The code expired. Try again for a new one.': 'O código expirou. Tente de novo para receber outro.',
  'That is not a link your Omni sends. It looks like https://your-omni/api/login/app?grant=…': 'Esse não é um link que seu Omni envia. O formato é https://your-omni/api/login/app?grant=…',

  // What a Bot type starts with: the welcome's rows and the host's
  'Reading what it starts with…': 'Lendo com o que começa…',
  'None': 'Nenhum',
  'Installs when Omni powers on': 'Instala quando você liga o Omni',
  'Installed': 'Instalado',
  'What this Bot is for: always on': 'É para isso que este Bot existe: sempre ligado',
  'Always on': 'Sempre ligado',
  '{label} for this Bot': '{label} para este Bot',
  'What it starts with': 'Com o que começa',
  'Model': 'Modelo',
  'Your DSH default': 'O padrão do seu DSH',
  'You pick it in Omni\'s first chat': 'Você escolhe no primeiro chat do Omni',
  '{ref} · you confirm it in Omni\'s first chat': '{ref} · você confirma no primeiro chat do Omni',
  'Thinking': 'Raciocínio',
  'The model\'s default': 'O padrão do modelo',
  'Plugins': 'Plugins',
  'Bot team': 'Equipe de Bots',
  'Bots, their chats, memory and settings': 'Bots, com chats, memória e configurações',
  'Omni channels': 'Canais do Omni',
  'Your channels and the chats on them': 'Seus canais e os chats de cada um',
  'Omni canvases': 'Canvases do Omni',
  'Live views drawn in the chat': 'Visualizações ao vivo desenhadas no chat',
  'channels': 'canais',
  'canvases': 'canvases',
  'Tools': 'Ferramentas',
  'Read channels and chats': 'Ler canais e chats',
  'Send, react and delete': 'Enviar, reagir e apagar',
  'Asks you before it writes to a person': 'Pergunta a você antes de escrever para uma pessoa',
  'Connect a channel': 'Conectar um canal',
  'Shows the QR code to scan': 'Mostra o QR code para escanear',
  'Any Omni operation': 'Qualquer operação do Omni',
  'Finds and runs the rest of Omni\'s API': 'Encontra e executa o resto da API do Omni',
  'Live canvases': 'Canvases ao vivo',
  'Shell and files': 'Shell e arquivos',
  'DSH\'s own tools; one-off work goes to Tasks': 'As ferramentas do próprio DSH; trabalho avulso vai para Tasks',
  'Skills': 'Skills',
  'None preloaded. Skills you add to DSH, or teach Omni later, show here.': 'Nenhuma pré-carregada. As skills que você adicionar ao DSH, ou ensinar ao Omni depois, aparecem aqui.',
  'Setup': 'Configuração',
  'Folder': 'Pasta',
  'Its own, in your team workspace': 'Própria, no espaço de trabalho da sua equipe',
  'Permissions': 'Permissões',
  'DSH\'s default': 'Padrão do DSH',
  '{preset} (DSH\'s default)': '{preset} (padrão do DSH)',
  'Genie': 'Genie',
  'Installs when Genie powers on': 'Instala quando você liga o Genie',
  'A Task per wish': 'Uma Task por desejo',
  'Under Genie, with its report in Genie\'s chat': 'Sob o Genie, com o relatório no chat do Genie',
  'Shell, files and git': 'Shell, arquivos e git',
  'In the wish\'s own copy of the project': 'Na cópia do projeto só desse desejo',
  'Unfold': 'Unfold',
  'The Unfold Bot, Unfold inside DSH': 'O Bot Unfold, Unfold dentro do DSH',
  'Unfold bridge': 'Ponte Unfold',
  'Unfold watches this DSH': 'Unfold acompanha este DSH',
  'Unfold session': 'Sessão Unfold',
  'Unfold\'s own session, in DSH': 'A sessão própria de Unfold, no DSH',
  'Unfold events and stream': 'Eventos e fluxo de Unfold',
  'What Unfold did, as it happens': 'O que Unfold fez, enquanto acontece',
  'Unfold Mind': 'Unfold Mind',
  'What Unfold is thinking': 'O que Unfold está pensando',
  'Unfold capabilities, settings and trajectory': 'Capacidades, configurações e trajetória de Unfold',
  'What Unfold can do, its settings, each run step by step': 'O que Unfold sabe fazer, as configurações e cada execução passo a passo',
  'Comes with this DSH': 'Vem com este DSH',
  'Installs when Unfold powers on': 'Instala quando você liga Unfold',
  'Leads': 'Lidera',
  'Your Main Bot here': 'Seu Bot principal aqui',
  'Joins your team beside your Main Bot': 'Entra na sua equipe ao lado do seu Bot principal',

  // The boxes: status lines, lights, what shows inside
  'Powered off': 'Energia desligada',
  'Powered off · not on your team': 'Energia desligada · fora da sua equipe',
  'Installing {title} · {at} of {count}': 'Instalando {title} · {at} de {count}',
  'Installing Omni…': 'Instalando o Omni…',
  'Found an Omni': 'Um Omni encontrado',
  'Found {count} Omnis': '{count} Omnis encontrados',
  'Found Omnis, none ready to connect': 'Omnis encontrados, nenhum pronto para conectar',
  'Connected to {origin}': 'Conectado a {origin}',
  'Connected': 'Conectado',
  'Waking up…': 'Acordando…',
  'Starting Omni in this DSH…': 'Iniciando o Omni neste DSH…',
  'Looking for a connection…': 'Procurando uma conexão…',
  'Where should Omni live?': 'Onde o Omni deve morar?',
  'Approve this device on your phone': 'Aprove este dispositivo no seu celular',
  'Downloading Bun for Omni…': 'Baixando o Bun para o Omni…',
  'Setting up your Omni…': 'Configurando seu Omni…',
  'Installed · restart DSH to start it': 'Instalação concluída · reinicie o DSH para começar',
  'Could not install Omni': 'Não foi possível instalar o Omni',
  'Installing Genie…': 'Instalando o Genie…',
  'Starting Genie in this DSH…': 'Iniciando o Genie neste DSH…',
  'Ready for a wish': 'À espera de um desejo',
  'Could not install Genie': 'Não foi possível instalar o Genie',
  'Installing Unfold…': 'Instalando Unfold…',
  'Starting Unfold in this DSH…': 'Iniciando Unfold neste DSH…',
  'On your team': 'Na sua equipe',
  'Could not install Unfold': 'Não foi possível instalar Unfold',
  'power': 'energia',
  'plugins': 'plugins',
  'link': 'conexão',
  'team': 'equipe',
  'The Omni plugins': 'Os plugins do Omni',
  'Power {name} off': 'Desligar {name}',
  'Power {name} on': 'Ligar {name}',
  'What Omni\'s installer printed': 'A saída do instalador do Omni',
  'What went wrong is above. Power Omni on to try again.': 'O que deu errado está acima. Ligue o Omni para tentar de novo.',
  'In your menu': 'No seu menu',
  'Restart DSH, then power Omni on again.': 'Reinicie o DSH e ligue o Omni de novo.',
  'Add the Omni plugins on DSH\'s Plugins page.': 'Adicione os plugins do Omni na página Plugins do DSH.',
  'What the Genie install printed': 'A saída da instalação do Genie',
  'Restart DSH, then power Genie on again.': 'Reinicie o DSH e ligue o Genie de novo.',
  'Add @automagik/genie-dsh on DSH\'s Plugins page.': 'Adicione @automagik/genie-dsh na página Plugins do DSH.',
  'What went wrong is above. Power Genie on to try again.': 'O que deu errado está acima. Ligue o Genie para tentar de novo.',
  'Restart DSH, then power Unfold on again.': 'Reinicie o DSH e ligue Unfold de novo.',
  'Add @automagik/unfold-bot-dsh on DSH\'s Plugins page.': 'Adicione @automagik/unfold-bot-dsh na página Plugins do DSH.',
  'Genie is ready for wishes. For its skills too, like /wish, install its command line once, in a terminal:': 'Genie já recebe desejos. Para ter também as skills, como /wish, instale a linha de comando do Genie uma vez, num terminal:',

  // The cards
  'Remove': 'Remover',
  'Every chat on every channel, answered by your team.': 'Cada chat em cada canal, respondido pela sua equipe.',
  'Give it a wish, get one delivery.': 'Faça um desejo, receba uma entrega.',
  'Unfold itself, working inside DSH.': 'Unfold em pessoa, trabalhando dentro do DSH.',

  // The speech bubble
  '{name} here! Omni is asleep. Click its power button to bring it along.': '{name} aqui! O Omni está dormindo. Clique no botão de energia para trazer o Omni junto.',
  'Omni is waking up…': 'O Omni está acordando…',
  'Bringing Omni into this DSH. One moment.': 'Trazendo o Omni para este DSH. Um momento.',
  'Omni is starting up…': 'O Omni está iniciando…',
  'Omni is looking for a connection…': 'O Omni está procurando uma conexão…',
  'Omni found where your channels live!': 'O Omni encontrou onde seus canais moram!',
  'No Omni here yet. Tell Omni where yours lives.': 'Ainda não tem Omni aqui. Diga ao Omni onde o seu mora.',
  'Approve this device, and Omni connects.': 'Aprove este dispositivo e o Omni se conecta.',
  'Omni is moving in. This takes a few minutes the first time.': 'O Omni está se mudando. Da primeira vez, isso leva alguns minutos.',
  'Omni is connected to {origin}!': 'O Omni está conectado a {origin}!',
  'Omni is connected!': 'O Omni está conectado!',
  'Omni is installed. Restart DSH to wake it.': 'O Omni está instalado. Reinicie o DSH para acordar o Omni.',
  'Omni could not be installed here.': 'Não foi possível instalar o Omni aqui.',
  'Unfold is waking up…': 'Unfold está acordando…',
  'Bringing Unfold into this DSH. One moment.': 'Trazendo Unfold para este DSH. Um momento.',
  'Unfold is starting up…': 'Unfold está iniciando…',
  'Unfold is on your team.': 'Unfold está na sua equipe.',
  'Unfold is installed. Restart DSH to wake it.': 'A instalação de Unfold terminou. Reinicie o DSH para acordar Unfold.',
  'Unfold could not be installed here.': 'Não foi possível instalar Unfold aqui.',
  'Genie is waking up…': 'O Genie está acordando…',
  'Bringing Genie into this DSH. One moment.': 'Trazendo o Genie para este DSH. Um momento.',
  'Genie is starting up…': 'O Genie está iniciando…',
  'Genie is on your team. Give it a wish once you are in!': 'O Genie está na sua equipe. Faça um desejo assim que entrar!',
  'Genie is installed. Restart DSH to wake it.': 'A instalação do Genie terminou. Reinicie o DSH para acordar o Genie.',
  'Genie could not be installed here.': 'Não foi possível instalar o Genie aqui.',

  // The step itself
  'Your companion': 'Sua companhia',
  'Grow your team': 'Aumente sua equipe',
  '{name} leads. Who comes along?': '{name} lidera. Quem vem junto?',
  'Bringing them in…': 'Trazendo a equipe…',
  'Omni is moving in…': 'O Omni está se mudando…',
  'Omni is waking…': 'O Omni está acordando…',
  'Genie is waking…': 'O Genie está acordando…',
  'Unfold is waking…': 'Unfold está acordando…',
  'Continue with just {name}': 'Continuar só com {name}',
  'Continue with {who}': 'Continuar com {who}',
  ' and ': ' e ',
}

// English is the key itself; registering it keeps the namespace whole in both languages.
const EN = Object.fromEntries(Object.keys(PT_BR).map(key => [key, key]))

const fill = (text, params) => (params
  ? text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
  : text)

let bound = null

// `locale` is the DSH locale service; without one, copy stays English.
export function installLocale(locale) {
  if (!locale || typeof locale.register !== 'function' || typeof locale.bind !== 'function') return () => {}
  const off = locale.register(NAMESPACE, { en: EN, 'pt-BR': PT_BR })
  const mine = locale.bind(NAMESPACE)
  bound = mine
  return () => {
    if (bound === mine) bound = null
    if (typeof off === 'function') off()
  }
}

export function t(key, params) {
  return bound ? bound(key, params) : fill(key, params)
}
