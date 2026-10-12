#!/usr/bin/env python3
"""Writes ProjectSettings/InputManager.asset: Unity's default axes plus the gamepad axes the cricket game reads
(PadLX/PadLY left stick, PadRX/PadRY right stick, PadDX/PadDY d-pad on desktop). Buttons are read as
KeyCode.JoystickButtonN, which needs no entries. Usage: python3 Tools/make_input_manager.py"""
import os

def axis(name, neg='', pos='', altneg='', altpos='', gravity=0, dead=0.001, sens=1, snap=0, invert=0, type_=0, ax=0):
    return f"""  - serializedVersion: 3
    m_Name: {name}
    descriptiveName:
    descriptiveNegativeName:
    negativeButton: {neg}
    positiveButton: {pos}
    altNegativeButton: {altneg}
    altPositiveButton: {altpos}
    gravity: {gravity}
    dead: {dead}
    sensitivity: {sens}
    snap: {snap}
    invert: {invert}
    type: {type_}
    axis: {ax}
    joyNum: 0
"""

axes = [
    axis('Horizontal', 'left', 'right', 'a', 'd', 3, 0.001, 3, 1),
    axis('Vertical', 'down', 'up', 's', 'w', 3, 0.001, 3, 1),
    axis('Fire1', '', 'left ctrl', '', 'mouse 0', 1000, 0.001, 1000),
    axis('Fire2', '', 'left alt', '', 'mouse 1', 1000, 0.001, 1000),
    axis('Fire3', '', 'left shift', '', 'mouse 2', 1000, 0.001, 1000),
    axis('Jump', '', 'space', '', '', 1000, 0.001, 1000),
    axis('Mouse X', sens=0.1, type_=1, ax=0, dead=0),
    axis('Mouse Y', sens=0.1, type_=1, ax=1, dead=0),
    axis('Mouse ScrollWheel', sens=0.1, type_=1, ax=2, dead=0),
    axis('Horizontal', dead=0.19, type_=2, ax=0),
    axis('Vertical', dead=0.19, invert=1, type_=2, ax=1),
    axis('Submit', '', 'return', '', 'joystick button 0', 1000, 0.001, 1000),
    axis('Submit', '', 'enter', '', 'space', 1000, 0.001, 1000),
    axis('Cancel', '', 'escape', '', 'joystick button 1', 1000, 0.001, 1000),
    # Gamepad sticks (browser "standard" mapping: axes 0-3 = left x/y, right x/y).
    axis('PadLX', dead=0.15, type_=2, ax=0),
    axis('PadLY', dead=0.15, invert=1, type_=2, ax=1),
    axis('PadRX', dead=0.15, type_=2, ax=2),
    axis('PadRY', dead=0.15, invert=1, type_=2, ax=3),
    # Desktop pads report the d-pad as axes 6/7 (Xbox layout); in browsers it arrives as buttons 12-15.
    axis('PadDX', dead=0.2, type_=2, ax=5),
    axis('PadDY', dead=0.2, type_=2, ax=6),
]

here = os.path.dirname(os.path.abspath(__file__))
path = os.path.join(here, '..', 'ProjectSettings', 'InputManager.asset')
with open(path, 'w') as f:
    f.write('%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n--- !u!13 &1\nInputManager:\n  m_ObjectHideFlags: 0\n  serializedVersion: 2\n  m_Axes:\n')
    f.write(''.join(axes))
    f.write('  m_UsePhysicalKeys: 1\n')
print('wrote', os.path.normpath(path))
