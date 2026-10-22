const skillGroups = [
  {
    name: "Resistências",
    skills: [
      { id: "agilidade", name: "Agilidade" },
      { id: "fortitude", name: "Fortitude" },
      { id: "vontade", name: "Vontade" },
    ],
  },
  {
    name: "Equipamentos",
    skills: [
      { id: "armaduras", name: "Armaduras" },
      { id: "armas-de-fogo", name: "Armas de Fogo" },
      { id: "armas-simples", name: "Armas Simples" },
    ],
  },
  {
    name: "Especialidades",
    skills: [
      { id: "acrobacia", name: "Acrobacia" },
      { id: "artes", name: "Artes" },
      { id: "atletismo", name: "Atletismo" },
      { id: "ciencias", name: "Ciências" },
      { id: "cultura", name: "Cultura" },
      { id: "destreza", name: "Destreza" },
      { id: "diplomacia", name: "Diplomacia" },
      { id: "empatia", name: "Empatia" },
      { id: "enganacao", name: "Enganação" },
      { id: "forca", name: "Força" },
      { id: "furtividade", name: "Furtividade" },
      { id: "intimidacao", name: "Intimidação" },
      { id: "ocultismo", name: "Ocultismo" },
      { id: "percepcao", name: "Percepção" },
      { id: "tatica", name: "Tática" },
      { id: "tecnologia", name: "Tecnologia" },
    ],
  },
];

export const SKILL_GROUPS = Object.freeze(skillGroups.map((group) => Object.freeze({
  name: group.name,
  skills: Object.freeze(group.skills.map((skill) => Object.freeze({ ...skill }))),
})));

export const ALL_SKILLS = Object.freeze(SKILL_GROUPS.flatMap((group) =>
  group.skills.map((skill) => Object.freeze({ ...skill, group: group.name })),
));

export const INITIATIVE_SKILLS = Object.freeze(ALL_SKILLS.map(({ id, name }) => Object.freeze({ id, name })));
