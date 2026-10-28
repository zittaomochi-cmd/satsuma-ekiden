"""大会PDFのコース図から抜き出した線（pdf-course-raw.json）を緯度経度に直し、js/course.js を作る。

位置合わせの係数（GEO）は trace.html で地理院地図に重ねて合わせた値。
試走のGPSログで差し替える場合は js/course.js の route を直接置き換えればよい。
"""
import json, math, os

HERE = os.path.dirname(os.path.abspath(__file__))
GEO = dict(lat0=31.933217104029332, lng0=130.38181444799545, sx=0.000012446815699354654, sy=0.000010566305290897912)
X0, Y0 = 235.92, 330


def to_ll(px, py):
    # PDFページ座標 (x, y) → 表示座標 X=y, Y=x → 緯度経度
    X, Y = py, px
    return (round(GEO['lat0'] - (Y - Y0) * GEO['sy'], 6), round(GEO['lng0'] + (X - X0) * GEO['sx'], 6))


def dist(a, b):
    dy = (a[0] - b[0]) * 110900
    dx = (a[1] - b[1]) * 110900 * math.cos(math.radians(a[0]))
    return math.hypot(dx, dy)


raw = json.load(open(os.path.join(HERE, 'pdf-course-raw.json')))
thick = [p['subs'][0] for p in raw if p['w'] > 10]
loop_b, loop_a, conn = [[to_ll(*pt) for pt in s] for s in thick]  # 70点, 61点, 15点

# 中継所の四角（左下の角）→ 中心
boxes = {
    'start': (2743, 3441), 'r1': (1587, 3220), 'r2': (1083, 2456), 'r3': (2313, 3144),
    'r5': (3343, 4164), 'r6': (3477, 4516), 'r12': (3527, 4320), 'goal': (2899, 4333),
}
box_ll = {}
for p in raw:
    if p['w'] > 10:
        continue
    for s in p['subs']:
        if len(s) == 5:
            for k, (bx, by) in boxes.items():
                if abs(s[0][0] - bx) < 2 and abs(s[0][1] - by) < 2:
                    cx = sum(q[0] for q in s[:4]) / 4
                    cy = sum(q[1] for q in s[:4]) / 4
                    box_ll[k] = to_ll(cx, cy)
assert len(box_ll) == 8, box_ll


def nearest_idx(line, p):
    return min(range(len(line)), key=lambda i: dist(line[i], p))


def orient(loop, first, later):
    """閉じたループを、first の中継所が later より先に来る向きにそろえる"""
    if nearest_idx(loop, box_ll[first]) > nearest_idx(loop, box_ll[later]):
        loop = loop[::-1]
    return loop


def rotate_closed(loop, p):
    """閉じたループを点 p に一番近い頂点から始まるよう回す（終点=始点）"""
    body = loop[:-1]
    i = nearest_idx(body, p)
    body = body[i:] + body[:i]
    return body + [body[0]]


# 接続路は ループA合流点 → スタート の向き
s_to_j = conn[::-1]
j = s_to_j[-1]
loop_a = orient(rotate_closed(loop_a, j), 'r1', 'r3')
loop_b = orient(rotate_closed(loop_b, box_ll['start']), 'r5', 'r6')
# ループBの r12 と r5 の順も確認
assert nearest_idx(loop_b, box_ll['r5']) < nearest_idx(loop_b, box_ll['r12']) < nearest_idx(loop_b, box_ll['r6']) < nearest_idx(loop_b, box_ll['goal'])

lap_a = s_to_j + loop_a[1:] + conn[1:]
goal_i = nearest_idx(loop_b, box_ll['goal'])
route = lap_a + loop_b[1:] + lap_a[1:] + loop_b[1:goal_i + 1]
route = [p for i, p in enumerate(route) if i == 0 or p != route[i - 1]]

cum = [0.0]
for a, b in zip(route, route[1:]):
    cum.append(cum[-1] + dist(a, b))

# 中継所を順に、前の中継所より後ろで一番近い点に割り当てる
order = ['r1', 'r2', 'r3', 'start', 'r5', 'r6', 'start', 'r1', 'r2', 'r3', 'start', 'r12', 'goal']
legs_km = [1.57, 1.34, 1.93, 0.73, 1.11, 0.88, 2.32, 1.57, 1.34, 1.93, 0.73, 1.41, 1.43]
idx = [0]
for key in order:
    lo = idx[-1] + 1
    # 次の中継所より先へ行かないよう、公式距離から見込んだ位置の±1.2kmだけ探す
    expect = cum[idx[-1]] + legs_km[len(idx) - 1] * 1000 * (cum[-1] / 18290)
    cand = [i for i in range(lo, len(route)) if abs(cum[i] - expect) < 1200]
    idx.append(min(cand, key=lambda i: dist(route[i], box_ll[key])))
idx[-1] = len(route) - 1

relay_names = {
    'start': '白男川紫陽館前', 'r1': '新中間橋北', 'r2': '栗山商店前', 'r3': 'きららの楽校前',
    'r5': '梁原橋北', 'r6': '下川口三差路北', 'r12': '小八重製作所前', 'goal': 'かぐや姫グラウンド入口',
}
runners = ['30歳代', '女子（フリー）', '中高生男子', '女子（フリー）', '50歳代', '小学生女子', 'フリー',
           '40歳代', '小学生男子', '29歳以下', '小学生女子', '小学生男子', '中高生男子']
plan = ['10:00', '10:04', '10:08', '10:13', '10:15', '10:20', '10:23', '10:30', '10:35', '10:40', '10:46', '10:48', '10:52', '10:56']

legs = []
for n in range(13):
    legs.append({
        'no': n + 1, 'runner': runners[n], 'km': legs_km[n],
        'from': relay_names['start'] if n == 0 else relay_names[order[n - 1]],
        'to': relay_names[order[n]], 'planFrom': plan[n], 'planTo': plan[n + 1],
        'i0': idx[n], 'i1': idx[n + 1],
    })

for n, l in enumerate(legs):
    print(f"{l['no']:>2}区 {l['from']}→{l['to']}  公式{l['km']}km  線上{(cum[l['i1']] - cum[l['i0']]) / 1000:.2f}km")
print('全長(線上)', round(cum[-1]) / 1000, 'km  点数', len(route))

relays = [{'key': k, 'name': relay_names[k], 'lat': v[0], 'lng': v[1]} for k, v in box_ll.items()]
out = {
    'title': '第22回 さつま町駅伝競走大会', 'date': '2026-11-08', 'start': '10:00', 'totalKm': 18.29,
    'route': route, 'legs': legs, 'relays': relays,
}
with open(os.path.join(HERE, '..', 'js', 'course.js'), 'w') as f:
    f.write('// tools/build-course.py で生成（大会PDFのコース図から）。試走のGPSログで route を差し替えると精度が上がる\n')
    f.write('export const COURSE = ' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n')
