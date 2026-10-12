#!/usr/bin/env python3
"""Builds and runs the offline match test with the .NET SDK (no Unity needed): the real simulation and match director
(Assets/Cricket/Scripts/Sim, Game, Core/Settings.cs) plus small UnityEngine stand-ins.
Usage: python3 Tools/MatchSim/run.py [t20|t10|odi|super] [matches] [overs] [replays]"""
import glob, json, os, subprocess, sys, tempfile

here = os.path.dirname(os.path.abspath(__file__))
project = os.path.normpath(os.path.join(here, '..', '..'))
csc = sorted(glob.glob('/usr/lib/dotnet/sdk/*/Roslyn/bincore/csc.dll') + glob.glob('/usr/share/dotnet/sdk/*/Roslyn/bincore/csc.dll')
             + glob.glob(os.path.expanduser('~/.dotnet/sdk/*/Roslyn/bincore/csc.dll')))
runtimes = sorted(glob.glob('/usr/lib/dotnet/shared/Microsoft.NETCore.App/*') + glob.glob('/usr/share/dotnet/shared/Microsoft.NETCore.App/*'))
if not csc or not runtimes:
    sys.exit('Needs the .NET 8 SDK (dotnet).')
runtime = runtimes[-1]
out = tempfile.mkdtemp(prefix='cricket-match-')
scripts = os.path.join(project, 'Assets/Cricket/Scripts')
sources = sorted(glob.glob(os.path.join(scripts, 'Sim/*.cs')) + glob.glob(os.path.join(scripts, 'Game/*.cs')))
sources += [os.path.join(scripts, 'Core/Settings.cs'), os.path.join(project, 'Tools/PhysicsSim/UnityShim.cs'),
            os.path.join(here, 'GameShim.cs'), os.path.join(here, 'Program.cs')]
refs = [f for f in glob.glob(os.path.join(runtime, '*.dll')) if os.path.basename(f).startswith(('System', 'netstandard', 'mscorlib', 'Microsoft.CSharp'))]
exe = os.path.join(out, 'CricketMatch.dll')
args = ['dotnet', csc[-1], '-nologo', '-nostdlib+', '-target:exe', '-langversion:9.0', '-nowarn:CS0649,CS0414,CS0169,CS0067,CS0219', '-out:' + exe] + ['-r:' + r for r in refs] + sources
p = subprocess.run(args, capture_output=True, text=True)
if p.returncode != 0:
    print(p.stdout, p.stderr)
    sys.exit(1)
json.dump({'runtimeOptions': {'tfm': 'net8.0', 'framework': {'name': 'Microsoft.NETCore.App', 'version': os.path.basename(runtime)}}},
          open(os.path.join(out, 'CricketMatch.runtimeconfig.json'), 'w'))
sys.exit(subprocess.run(['dotnet', exe] + sys.argv[1:]).returncode)
