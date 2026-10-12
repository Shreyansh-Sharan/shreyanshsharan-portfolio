using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;

namespace Cricket.EditorTools
{
    /// <summary>
    /// First open: offers to generate the game (so nobody lands in an empty "Untitled" scene).
    /// Later opens: opens the cricket scene if the editor starts on an empty untitled scene.
    /// </summary>
    [InitializeOnLoad]
    static class CricketAutoSetup
    {
        const string ScenePath = "Assets/Cricket/Scenes/Cricket.unity";
        const string AskedKey = "Cricket.AutoSetup.Asked";

        static CricketAutoSetup()
        {
            EditorApplication.delayCall += Run;
        }

        static void Run()
        {
            if (UnityEngine.Application.isBatchMode) return;
            if (EditorApplication.isPlayingOrWillChangePlaymode || BuildPipeline.isBuildingPlayer) return;
            var active = EditorSceneManager.GetActiveScene();
            bool emptyUntitled = string.IsNullOrEmpty(active.path) && !active.isDirty;
            if (!File.Exists(ScenePath))
            {
                if (SessionState.GetBool(AskedKey, false)) return;
                SessionState.SetBool(AskedKey, true);
                if (EditorUtility.DisplayDialog("Cricket",
                        "The cricket scene hasn't been generated yet.\n\nGenerate the materials, characters, network prefab and scene now? It takes under a minute.",
                        "Generate now", "Later"))
                {
                    CricketSetup.Generate();
                    EditorSceneManager.OpenScene(ScenePath);
                }
                return;
            }
            if (emptyUntitled) EditorSceneManager.OpenScene(ScenePath);
        }
    }
}
