"""Offline inspection of one pinned BTS package. No SWF execution or MIDI I/O.

Independently decodes only the SWF container and ABC string constant pool, then
checks the exact id/min/max/step operands at recorded FWS byte offsets. This is
not a general AVM2 interpreter or a claim that every firmware accepts the ranges.
"""
import argparse
import hashlib
import json
from pathlib import Path
import zlib


def u30(data, pos):
    value = 0
    for shift in range(0, 35, 7):
        byte = data[pos]
        pos += 1
        value |= (byte & 127) << shift
        if byte < 128:
            return value, pos
    raise ValueError('Invalid U30')


def string_pool(data):
    pos = 8 + (5 + (data[8] >> 3) * 4 + 7) // 8 + 4
    while pos < len(data):
        header = int.from_bytes(data[pos:pos + 2], 'little')
        pos += 2
        size = header & 63
        if size == 63:
            size = int.from_bytes(data[pos:pos + 4], 'little')
            pos += 4
        end = pos + size
        if header >> 6 == 82:
            name_end = data.index(0, pos + 4, end)
            if data[pos + 4:name_end] == b'frame2':
                pos = name_end + 1 + 4  # ABC minor/major
                for width in (0, 0, 8):
                    count, pos = u30(data, pos)
                    for _ in range(1, count):
                        if width:
                            pos += width
                        else:
                            _, pos = u30(data, pos)
                count, pos = u30(data, pos)
                strings = ['']
                for _ in range(1, count):
                    size, pos = u30(data, pos)
                    strings.append(data[pos:pos + size].decode('utf8'))
                    pos += size
                return strings
        pos = end
    raise ValueError('Missing frame2 DoABC')


def pushed_string(data, strings, pos):
    if data[pos] != 0x2c:
        raise ValueError(f'Expected pushstring at {pos:#x}')
    index, end = u30(data, pos + 1)
    return strings[index], end


def inspect(root):
    swf = (root / 'BOSS_TONE_STUDIO_for_KATANA.swf').read_bytes()
    address_bytes = (root / '_assets/data/addressmap_gt.json').read_bytes()
    swf_sha = hashlib.sha256(swf).hexdigest()
    map_sha = hashlib.sha256(address_bytes).hexdigest()
    if swf_sha != '28674f980ae8c854b6888138d86d22c65bfbcc8007d80ae85b89f065b2350480' or map_sha != '57714a40077d200f2cf55e4869b7c0475dcB24a996c77bb54655a2d2131bd7e4'.lower():
        raise ValueError('Package hash differs; do not reuse fixed offsets')
    if swf[:3] != b'CWS':
        raise ValueError('Expected pinned compressed SWF')
    data = b'FWS' + swf[3:8] + zlib.decompress(swf[8:])
    if len(data) != int.from_bytes(data[4:8], 'little'):
        raise ValueError('Declared SWF size mismatch')
    strings = string_pool(data)
    facts = []
    # key, address-map name, ABC id, id opcode offset, min opcode offset, max
    rows = [
        ('TemporaryGain', 'PREAMP A: GAIN', 'preamp_a_gain', 0x911477, 0x91148c, 120),
        ('TemporaryLevel', 'PREAMP A: LEVEL', 'preamp_a_level', 0x911534, 0x911549, 100),
        ('TemporaryBass', 'PREAMP A: BASS', 'preamp_a_bass', 0x9115b2, 0x9115c7, 100),
        ('TemporaryMiddle', 'PREAMP A: MIDDLE', 'preamp_a_middle', 0x9115f1, 0x911606, 100),
        ('TemporaryTreble', 'PREAMP A: TREBLE', 'preamp_a_treble', 0x911630, 0x911645, 100),
        ('TemporaryPresence', 'PREAMP A: PRESENCE', 'preamp_a_presence', 0x91166f, 0x911684, 100),
        ('NoiseSuppressorThreshold', 'NS1: THRESHOLD', 'ns1_threshold', 0x91a25d, 0x91a272, 100),
        ('ReverbLevel', 'REVERB: EFFECT LEVEL', 'reverb_effect_level', 0x919a16, 0x919a2b, 100),
        ('DelayLevel', 'DELAY: EFFECT LEVEL', 'delay_effect_level', 0x9185a2, 0x9185b7, 120),
    ]
    entries = json.loads(address_bytes)['temporary']
    for key, label, identifier, id_offset, range_offset, maximum in rows:
        if pushed_string(data, strings, id_offset)[0] != identifier:
            raise ValueError(f'Unexpected ABC id: {key}')
        values = {}
        pos = range_offset
        for expected, value in [('min', 0), ('max', maximum), ('step', 1)]:
            name, pos = pushed_string(data, strings, pos)
            if name != expected or data[pos:pos + 2] != bytes([0x24, value]):
                raise ValueError(f'Unexpected {key} {expected}')
            pos += 2
            values[name] = value
        mapped = [p for p in entries if p.get('name') == label]
        if len(mapped) != 1 or mapped[0]['size'] != '00,00,00,01':
            raise ValueError(f'Unexpected map entry: {label}')
        facts.append({'key': key, 'addressMapName': label, 'address': mapped[0]['address'],
            'abcId': identifier, 'idOpcodeFwsOffset': hex(id_offset),
            'rangeStartFwsOffset': hex(range_offset), **values})
    return {'status': 'PASS', 'authority': 'installed BTS 4.0.0 static definitions; not a hardware range sweep',
        'swfSha256': swf_sha, 'addressMapSha256': map_sha, 'facts': facts,
        'limitations': 'Does not establish raw/panel conversion, firmware-wide support, acoustic volume safety or persistence.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bts-dir', type=Path, default=Path('C:/Program Files (x86)/BOSS TONE STUDIO for KATANA'))
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    text = json.dumps(inspect(args.bts_dir), indent=2) + '\n'
    if args.output:
        with args.output.open('x', encoding='utf8', newline='\n') as destination:
            destination.write(text)
    print(text)
