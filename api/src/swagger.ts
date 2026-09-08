import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'VanPro API',
      version: '2.0.0',
      description: 'Documentação Oficial da API do VanPro Elite SaaS',
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Servidor de Desenvolvimento',
      },
    ],
    components: {
      securitySchemes: {
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'token',
        },
      },
    },
    security: [
      {
        cookieAuth: [],
      },
    ],
  },
  apis: ['./src/routes/*.ts'], // Aponta para onde estão os comentários das rotas
};

export const swaggerSpec = swaggerJsdoc(options);
