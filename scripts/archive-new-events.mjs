import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const cdn = 'https://growth-img.xhscdn.com/ditto/';
const desktopRoot = '/Users/yilei/Desktop/竞品追踪/小红书创作活动';
const publicRoot = '/Users/yilei/Documents/ChatGPT/小红书创作活动获取/public/events';

const events = [
  {
    slug: 'travel-transition', title: '小红书旅行转场上新了', date: '08-05 至 08-31', height: 5133,
    pageUrl: 'https://fe.xiaohongshu.com/ditto/vincent/ac7e421f2bb149249f3261eea59d607a?fullscreen=true&resource_instance_id=314960&naviHidden=yes&source=creator_activity_center',
    thumbnail: '104100n0323fnm8gi7u06j9smc8jpk00000000046kdbi4',
    video: '104100n0323he5dsfna06j9smc8jpk0000000001fjsvcs',
    assets: '104100n0323ep0mlcna06j9smc8jpk0000000005kbgluq 104100n0323he5gteg206j9smc8jpk0000000007nn8ea2 104100n0323he5gv97k06j9smc8jpk00000000042rvlg8 104100n0323d5jep6nk06j9smc8jpk0000000001vnhrlc 104100n0323d5jeq17a06j9smc8jpk0000000003f0226u 104100n0323d5jtf77k06j9smc8jpk0000000006td1vsi 104100n0323d5l81f0206j9smc8jpk0000000006614jla 104100n0323d5lcqh0a06j9smc8jpk0000000002li3uqo 104100n0323d5li66nk06j9smc8jpk0000000003dgc3jm 104100n0323d5lod97k06j9smc8jpk0000000007vcj7u4 104100n0323d5lt9ngae6j9smc8jpk0000000005uqveds 104100n0323iipd8i7a06j9smc8jpk0000000007s6g25g 104100n0323d5mbid7k06j9smc8jpk0000000002tjqdms 104100n0323d5mhpj0206j9smc8jpk0000000003v338qq 104100n0323d5mnn47a06j9smc8jpk0000000002fe5ani 104100n0323d5mtn37k06j9smc8jpk000000000559gjt0 104100n0323d5n2gtna06j9smc8jpk0000000007uagpjo 104100n0323d5ne13g206j9smc8jpk00000000010ejiu4 104100n0323d5ne1t7a76j9smc8jpk000000000724apm4 104100n0323eov2r30a06j9smc8jpk0000000001qt4qfg 104100n0323eov74tnk06j9smc8jpk0000000004tcot5o 104100n0323eovkdh7k06j9smc8jpk00000000054m80fm 104100n0323d5ocj4g206j9smc8jpk0000000001ecov6g 104100n0323g13o4cnu06j9smc8jpk0000000000v4r1pm 104100n0323he5dsfna06j9smc8jpk0000000001fjsvcs'.split(' '),
  },
  {
    slug: 'dance-debut', title: '小红书舞蹈出道夜', date: '08-03 至 08-31', height: 4713,
    pageUrl: 'https://fe.xiaohongshu.com/ditto/vincent/f5db1fe39823478a93657fbb126739db?fullscreen=true&resource_instance_id=314360&naviHidden=yes&source=creator_activity_center',
    thumbnail: '104100n0323d8bfkknu06kiockgjp60000000003htvses',
    video: '104100n03238ira7lnu06kiockgjp600000000031ilvla',
    assets: '104100n03238iu40hg206kiockgjp60000000006mhh6mq 104100n03238iu41h7uemkiockgjp6000000000306phai 104100n03238i8dqr0206kiockgjp600000000049l6gke 104100n03239d8dno7u06kiockgjp60000000006d1k4o6 104100n03239d8i1l7o06kiockgjp60000000004qa5rfo 104100n032396usugna06kiockgjp600000000042t7n96 104100n0323970n1r0206kiockgjp60000000004pavrk8 104100n0323975tm97k06kiockgjp60000000001l1ocku 104100n032397613ona06kiockgjp600000000044pn15s 104100n03239d5cggnk06kiockgjp60000000001ngsi08 104100n03239d5jnq7a06kiockgjp600000000044ctsdk 104100n03238ibfiag206kiockgjp60000000006cj817i 104100n03239fcggb7o06kiockgjp6000000000250ap9o 104100n03238ima4q7u06kiockgjp60000000002d25bbm 104100n03239haog57k06kiockgjp60000000006j4693c 104100n03239haogtg206kiockgjp60000000004ioqjbg 104100n03239feq067u06kiockgjp60000000005kn2vk6 104100n03239clskjnu06kiockgjp600000000062a7rvu 104100n03239cnlc1nk06kiockgjp6000000000044n8d6 104100n03238ira7lnu06kiockgjp600000000031ilvla'.split(' '),
  },
  {
    slug: 'summer-electronic-dream', title: '夏日电子梦', date: '08-03 至 09-10', height: 2177,
    pageUrl: 'https://fe.xiaohongshu.com/ditto/vincent/21af46ac931c4e47adc622c4df40fdc0?fullscreen=true&resource_instance_id=314275&naviHidden=yes&source=creator_activity_center',
    thumbnail: '104100n0323d8qailmu06b9ri6vr00000000000m8rkmaq.png',
    video: '104100n0323d71hms7u06b9ri6vr00000000000koij64i',
    assets: '104100n0323d73uffna06b9ri6vr00000000000ju3262e 104100n0323d73ugenk06b9ri6vr00000000000g7kf2us 104100n0323d75k0m7k06b9ri6vr00000000000lnh61b8 104100n0323d784rk0206b9ri6vr00000000000l0rbd64 104100n0323d78825g206b9ri6vr00000000000ko6rj5g 104100n0323d78fkc7a06b9ri6vr00000000000k5ibucg 104100n0323d78d5b0a06b9ri6vr00000000000l6ehlnc 104100n0323d78lj7g206b9ri6vr00000000000l0j4a6e 104100n0323d78jj3na06b9ri6vr00000000000ippb53s 104100n0323d78qoi7u06b9ri6vr00000000000k3vm0kk 104100n0323d78ossna06b9ri6vr00000000000hldeldo 104100n0323d7nlae0a06b9ri6vr00000000000j0ve3ii 104100n0323d7nlbgna06b9ri6vr00000000000ncrie1e 104100n0323d7nlcgna06b9ri6vr00000000000n3n8uci 104100n0323d71hms7u06b9ri6vr00000000000koij64i'.split(' '),
  },
];

const ext = type => type.includes('video') ? '.mp4' : type.includes('png') ? '.png' : type.includes('webp') ? '.webp' : '.bin';

for (const event of events) {
  const roots = [path.join(desktopRoot, event.title), path.join(publicRoot, event.slug)];
  for (const root of roots) await mkdir(path.join(root, 'original-assets'), { recursive: true });
  const records = [];
  for (let i = 0; i < event.assets.length; i++) {
    const id = event.assets[i], response = await fetch(cdn + id);
    if (!response.ok) throw new Error(`${response.status} ${id}`);
    const type = response.headers.get('content-type') || 'application/octet-stream';
    const bytes = new Uint8Array(await response.arrayBuffer());
    const name = `${id === event.video ? 'video' : 'asset'}-${String(i + 1).padStart(2, '0')}${ext(type)}`;
    for (const root of roots) await writeFile(path.join(root, 'original-assets', name), bytes);
    records.push({ id, name, type, bytes: bytes.byteLength, url: cdn + id });
  }
  const thumbResponse = await fetch(cdn + event.thumbnail);
  const thumbBytes = new Uint8Array(await thumbResponse.arrayBuffer());
  for (const root of roots) await writeFile(path.join(root, 'thumbnail.png'), thumbBytes);
  const manifest = { title: event.title, date: event.date, pageUrl: event.pageUrl, displayHeight: event.height, video: cdn + event.video, assets: records };
  for (const root of roots) await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`${event.slug}: ${records.length}`);
}
