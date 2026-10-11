using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;

namespace Arena.EditorTools
{
    /// <summary>
    /// First open: offers to generate the arena (so nobody lands in an empty "Untitled" scene).
    /// Later opens: opens the arena scene automatically if the editor starts on an empty untitled scene.
    /// </summary>
    [InitializeOnLoad]
    static class ArenaAutoSetup
    {
        const string ScenePath = "Assets/Arena/Scenes/Arena.unity";
        const string AskedKey = "Arena.AutoSetup.Asked";

        static ArenaAutoSetup()
        {
            EditorApplication.delayCall += Run;
        }

        static void Run()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode || BuildPipeline.isBuildingPlayer) return;
            var active = EditorSceneManager.GetActiveScene();
            bool emptyUntitled = string.IsNullOrEmpty(active.path) && !active.isDirty;

            if (!File.Exists(ScenePath))
            {
                if (SessionState.GetBool(AskedKey, false)) return;
                SessionState.SetBool(AskedKey, true);
                if (EditorUtility.DisplayDialog(
                        "Dunes Arena",
                        "The arena scene hasn't been generated yet.\n\nGenerate the map, characters, bots and scene now? It takes about a minute.",
                        "Generate now", "Later"))
                {
                    ArenaSetup.Generate();
                }
                return;
            }

            if (emptyUntitled) EditorSceneManager.OpenScene(ScenePath);
        }
    }
}
