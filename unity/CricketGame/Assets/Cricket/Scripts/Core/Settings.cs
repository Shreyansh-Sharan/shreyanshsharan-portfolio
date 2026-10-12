using UnityEngine;

namespace Cricket
{
    /// <summary>Player preferences (PlayerPrefs, so they survive between visits).</summary>
    public static class Settings
    {
        static int GetI(string k, int d) { try { return PlayerPrefs.GetInt("cricket." + k, d); } catch { return d; } }
        static void SetI(string k, int v) { try { PlayerPrefs.SetInt("cricket." + k, v); PlayerPrefs.Save(); } catch { } }
        static float GetF(string k, float d) { try { return PlayerPrefs.GetFloat("cricket." + k, d); } catch { return d; } }
        static void SetF(string k, float v) { try { PlayerPrefs.SetFloat("cricket." + k, v); PlayerPrefs.Save(); } catch { } }

        /// <summary>0 behind the batter, 1 broadcast end-on.</summary>
        public static int BattingCam { get => GetI("batcam", 0); set => SetI("batcam", value); }
        /// <summary>0 behind the bowler, 1 broadcast end-on.</summary>
        public static int BowlingCam { get => GetI("bowlcam", 0); set => SetI("bowlcam", value); }
        public static bool Replays { get => GetI("replays", 1) == 1; set => SetI("replays", value ? 1 : 0); }
        /// <summary>The CPU calls the runs unless you call them yourself.</summary>
        public static bool AssistedRunning { get => GetI("assistrun", 1) == 1; set => SetI("assistrun", value ? 1 : 0); }
        public static bool ManualFielding { get => GetI("manualfield", 0) == 1; set => SetI("manualfield", value ? 1 : 0); }
        public static bool ShowAim { get => GetI("showaim", 1) == 1; set => SetI("showaim", value ? 1 : 0); }
        public static bool Commentary { get => GetI("commentary", 1) == 1; set => SetI("commentary", value ? 1 : 0); }
        public static bool LowGraphics { get => GetI("lowgfx", 0) == 1; set => SetI("lowgfx", value ? 1 : 0); }
        public static float Volume { get => GetF("volume", 0.8f); set { SetF("volume", value); AudioListener.volume = value; } }
        public static string PlayerName { get { try { return PlayerPrefs.GetString("cricket.name", "Player"); } catch { return "Player"; } } set { try { PlayerPrefs.SetString("cricket.name", value); } catch { } } }
        public static string TeamId { get { try { return PlayerPrefs.GetString("cricket.team", "northland"); } catch { return "northland"; } } set { try { PlayerPrefs.SetString("cricket.team", value); } catch { } } }
    }
}
