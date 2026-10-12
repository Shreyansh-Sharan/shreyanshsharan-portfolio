#!/usr/bin/env python3
"""Builds and runs the offline physics sanity sim with the .NET SDK (no Unity needed):
compiles Assets/Cricket/Scripts/Sim/*.cs + UnityShim.cs + Program.cs with Roslyn and runs it.
Usage: python3 Tools/PhysicsSim/run.py"""
import glob, json, os, subprocess, sys, tempfile

here = os.path.dirname(os.path.abspath(__file__))
project = os.path.normpath(os.path.join(here, '..', '..'))
csc = sorted(glob.glob('/usr/lib/dotnet/sdk/*/Roslyn/bincore/csc.dll') + glob.glob('/usr/share/dotnet/sdk/*/Roslyn/bincore/csc.dll')
             + glob.glob(os.path.expanduser('~/.dotnet/sdk/*/Roslyn/bincore/csc.dll')))
runtimes = sorted(glob.glob('/usr/lib/dotnet/shared/Microsoft.NETCore.App/*') + glob.glob('/usr/share/dotnet/shared/Microsoft.NETCore.App/*'))
if not csc or not runtimes:
    sys.exit('Needs the .NET 8 SDK (dotnet).')
runtime = runtimes[-1]
out = tempfile.mkdtemp(prefix='cricket-sim-')
sources = sorted(glob.glob(os.path.join(project, 'Assets/Cricket/Scripts/Sim/*.cs'))) + [os.path.join(here, 'UnityShim.cs'), os.path.join(here, 'Program.cs')]
refs = [f for f in glob.glob(os.path.join(runtime, '*.dll')) if os.path.basename(f).startswith(('System', 'netstandard', 'mscorlib', 'Microsoft.CSharp'))]
exe = os.path.join(out, 'CricketSim.dll')
args = ['dotnet', csc[-1], '-nologo', '-nostdlib+', '-target:exe', '-langversion:9.0', '-nowarn:CS0649,CS0414', '-out:' + exe] + ['-r:' + r for r in refs] + sources
p = subprocess.run(args, capture_output=True, text=True)
if p.returncode != 0:
    print(p.stdout, p.stderr)
    sys.exit(1)
version = os.path.basename(runtime)
json.dump({'runtimeOptions': {'tfm': 'net8.0', 'framework': {'name': 'Microsoft.NETCore.App', 'version': version}}}, open(os.path.join(out, 'CricketSim.runtimeconfig.json'), 'w'))
sys.exit(subprocess.run(['dotnet', exe]).returncode)
