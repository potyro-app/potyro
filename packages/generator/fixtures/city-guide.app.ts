import { defineApp } from "potyro";

export default defineApp({
  id: "city-guide",
  name: "City Guide",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    city: {
      label: "City",
      icon: "🏙️",
      displayField: "name",
      fields: {
        name: { type: "text", required: true },
        center: { type: "geo" },
        zoom: { type: "number", default: 12 },
      },
    },
    place: {
      label: "Place",
      icon: "📍",
      displayField: "name",
      fields: {
        name: { type: "text", required: true },
        city: { type: "relation", to: "city" },
        category: { type: "relation", to: "category" },
        location: { type: "geo" },
      },
    },
    category: {
      label: "Category",
      icon: "🏷️",
      displayField: "name",
      fields: {
        name: { type: "text", required: true },
      },
    },
  },
  pages: [
    {
      id: "cities",
      title: "Cities",
      view: {
        type: "list",
        entity: "city",
        display: { primary: "name" },
        onOpen: { page: "city-map", param: { cityId: "id" } },
      },
    },
    {
      id: "city-map",
      title: "City Map",
      hidden: true,
      view: {
        type: "map",
        entity: "city",
        geo: "center",
        title: "name",
        onOpen: { page: "city-detail", param: { cityId: "id" } },
      },
    },
    {
      id: "city-detail",
      title: "City",
      hidden: true,
      view: {
        type: "detail",
        entity: "city",
        param: "cityId",
        sections: [{ fields: ["name", "center", "zoom"] }],
      },
    },
    {
      id: "places",
      title: "Places",
      view: {
        type: "list",
        entity: "place",
        display: { primary: "name" },
        onOpen: { page: "place-detail", param: { placeId: "id" } },
      },
    },
    {
      id: "place-detail",
      title: "Place",
      hidden: true,
      view: {
        type: "detail",
        entity: "place",
        param: "placeId",
        sections: [{ fields: ["name", "city", "category", "location"] }],
      },
    },
    {
      id: "categories",
      title: "Categories",
      view: {
        type: "list",
        entity: "category",
        display: { primary: "name" },
        onOpen: { page: "category-detail", param: { categoryId: "id" } },
      },
    },
    {
      id: "category-detail",
      title: "Category",
      hidden: true,
      view: {
        type: "detail",
        entity: "category",
        param: "categoryId",
        sections: [{ fields: ["name"] }],
      },
    },
  ],
});
