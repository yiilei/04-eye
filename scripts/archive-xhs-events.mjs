import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = '/Users/yilei/Desktop/竞品追踪/小红书创作活动';
const base = 'https://growth-img.xhscdn.com/ditto/';

const events = [
  {
    name: '重返奥德赛',
    pageUrl: 'https://fe.xiaohongshu.com/ditto/vincent/aa65cb0e54e14c2883762bb30ad8c17d?fullscreen=true&resource_instance_id=316008&naviHidden=yes&source=creator_activity_center',
    pageSize: { width: 410, height: 8978 },
    activityRange: '08-08 至 09-15',
    media: '36 个原始 PNG 图层；无视频',
    assets: [
      ['104100n0316ekmjbpgo06cn9518r000000000018gpggnu',756],
      ['104100n0323ink6fd0a06klnbbojp20000000006p3241o',325],
      ['104100n0323igbt7qnk06klnbbojp200000000030mahss',0],
      ['104100n0323igcde57a06klnbbojp20000000002djev7u',177],
      ['104100n0323igcho10a06klnbbojp20000000002t5q0bo',306],
      ['104100n0323mfd3sugo06klnbbojp20000000002ajl2fg',492],
      ['104100n0323igcsqunk06klnbbojp20000000007m60mii',651],
      ['104100n0323igd2c6nk76klnbbojp20000000003go3j9s',745],
      ['104100n0323igdg9t0206klnbbojp200000000029ji5is',924],
      ['104100n0323igdkbhg206klnbbojp20000000005f17rig',1058],
      ['104100n0323igdr347a06klnbbojp20000000002jon3t8',1340],
      ['104100n0323ige0od0206klnbbojp20000000005520302',1522],
      ['104100n0323ige5kdnue6klnbbojp200000000061vjemg',1673],
      ['104100n0323iged130a06klnbbojp20000000003gq1u8g',1824],
      ['104100n0323injenv0a06klnbbojp20000000004hp02eu',1999],
      ['104100n0323igelb8nk06klnbbojp20000000002a1c604',2281],
      ['104100n0323igernt0206klnbbojp20000000006dvdeoc',2505],
      ['104100n0323igf8n1g206klnbbojp20000000003srbc2k',2698],
      ['104100n0323igfd3t7k06klnbbojp200000000057q7m18',2836],
      ['104100n0323igfg3bna06klnbbojp20000000001n52o5i',2970],
      ['104100n0323igfjsug206klnbbojp200000000046dr6va',3198],
      ['104100n0323igfpfq7u06klnbbojp200000000009k8r14',3363],
      ['104100n0323ihutd57k76klnbbojp200000000076g5qdu',3671],
      ['104100n0323ii511gnk06klnbbojp20000000002frc9ks',4115],
      ['104100n0323iia7987k06klnbbojp20000000007aft3cu',4540],
      ['104100n0323iivhpu0a06klnbbojp20000000006s63vb8',4896],
      ['104100n0323ijeagh7k06klnbbojp2000000000266ksrg',5267],
      ['104100n0323ijep3402s6klnbbojp20000000002jus79c',5407],
      ['104100n0323ijg6chnk06klnbbojp20000000005qokane',5501],
      ['104100n0323inijdj0206klnbbojp20000000007jragaa',5696],
      ['104100n0323ijghigga06klnbbojp20000000001km8jjm',5840],
      ['104100n0323ijgloe0a06klnbbojp200000000000n4l62',6050],
      ['104100n0323ijgr8g0a06klnbbojp200000000049rsdhk',6197],
      ['104100n0323ijgu4sga06klnbbojp200000000004tqlvq',6304],
      ['104100n0323ijhabu7a06klnbbojp20000000002sbnp4i',6503],
      ['104100n0323mfelmjgo06klnbbojp20000000006vak12q',6657],
    ].map(([id,y], index) => ({ id, y, role: 'layer', order: index + 1 })),
  },
  {
    name: '是谁走漏「风声」？',
    pageUrl: 'https://fe.xiaohongshu.com/ditto/vincent/a6869aa1691342ee9430df0ce82a8396?fullscreen=true&resource_instance_id=316026&naviHidden=yes&source=creator_activity_center',
    pageSize: { width: 410, height: 6563 },
    activityRange: '08-08 至 09-07',
    media: '9 个页面原始图层 + 7 张轮播原图；无视频',
    assets: [
      ['104100n0323nh1620go06deosvc900000000003e618mp6','layer',0],
      ['104100n0323nh162rnu06deosvc900000000003bmdg67u','layer',410],
      ['104100n0323iiii1onk76deosvc900000000003cm7b1ku','layer',579],
      ['104100n0323iiii347k06deosvc900000000003a7h5le4','layer',989],
      ['104100n0323k2f16d7u06deosvc900000000003fq292cm','layer',1221],
      ['104100n0323iiisvgga06deosvc900000000003bksnil0','layer',1432],
      ['104100n0323iiit0rnu06deosvc900000000003ds2fl5a','layer',1842],
      ['104100n0323iis2clg206deosvc900000000003cifl7va','layer',2887],
      ['104100n0323i8l146g206deosvc90000000000387ied0s','layer',3999],
      ['104100n0323iijt010a0mdeosvc9000000000039mh11ca','carousel',2070],
      ['104100n0323iij9kgna06deosvc900000000003d3bcf9c','carousel',2070],
      ['104100n0323iijf35na06deosvc900000000003bodnica','carousel',2070],
      ['104100n0323iiji7hnu06deosvc900000000003acutsk8','carousel',2070],
      ['104100n0323iijkot7k06deosvc900000000003aes68iu','carousel',2070],
      ['104100n0323iijni17a06deosvc900000000003aojkg7k','carousel',2070],
      ['104100n0323iijq1vga06deosvc900000000003at8gjc4','carousel',2070],
    ].map(([id,role,y], index) => ({ id, role, y, order: index + 1 })),
  },
];

const extFromType = (type) => type.includes('png') ? '.png' : type.includes('webp') ? '.webp' : type.includes('jpeg') ? '.jpg' : '.bin';

async function archive(event) {
  const dir = path.join(root, event.name);
  const assetDir = path.join(dir, '原始素材');
  await mkdir(assetDir, { recursive: true });
  const counters = { layer: 0, carousel: 0 };
  const records = [];
  for (const asset of event.assets) {
    counters[asset.role] += 1;
    const url = base + asset.id;
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    const type = response.headers.get('content-type') || 'application/octet-stream';
    const prefix = asset.role === 'carousel' ? '轮播' : '图层';
    const filename = `${prefix}-${String(counters[asset.role]).padStart(2, '0')}${extFromType(type)}`;
    const bytes = new Uint8Array(await response.arrayBuffer());
    await writeFile(path.join(assetDir, filename), bytes);
    records.push({ ...asset, filename, sourceUrl: url, contentType: type, bytes: bytes.byteLength });
  }
  const manifest = { platform: '小红书', capturedAt: new Date().toISOString(), title: event.name, activityRange: event.activityRange, pageUrl: event.pageUrl, pageSize: event.pageSize, media: event.media, note: '仅归档活动自身的 growth-img 原始素材；未混入用户笔记图片和头像。y 为 410px 宽 H5 中的纵向位置。', assets: records };
  await writeFile(path.join(dir, '素材清单.json'), JSON.stringify(manifest, null, 2));
  return { name: event.name, dir, count: records.length, bytes: records.reduce((n, x) => n + x.bytes, 0) };
}

const results = [];
for (const event of events) results.push(await archive(event));
console.log(JSON.stringify(results, null, 2));
