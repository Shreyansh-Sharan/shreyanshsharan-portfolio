namespace Arena.Map
{
    /// <summary>Every map in the game, in menu order. All of them live in the one scene, far apart.</summary>
    public static class Maps
    {
        public static readonly MapDefinition[] All = { DunesMap.Create(), HarborMap.Create(), FrostMap.Create() };

        public static int IndexOf(string id)
        {
            for (int i = 0; i < All.Length; i++)
                if (string.Equals(All[i].Id, id, System.StringComparison.OrdinalIgnoreCase)) return i;
            return 0;
        }

        public static MapDefinition Get(int index) => All[index >= 0 && index < All.Length ? index : 0];
    }
}
