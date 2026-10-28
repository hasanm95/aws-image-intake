const { S3Client, HeadObjectCommand, CopyObjectCommand } = require("@aws-sdk/client-s3");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand } = require("@aws-sdk/lib-dynamodb");

const isLocalstack = process.env.AWS_SAM_LOCAL || process.env.LOCALSTACK_HOSTNAME;
const endpoint = isLocalstack ? `http://${process.env.LOCALSTACK_HOSTNAME || 'localhost'}:4566` : undefined;
const clientConfig = endpoint ? { endpoint, region: "us-east-1" } : {};

const s3Client = new S3Client({})
const dbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dbClient);

const TABLE_NAME = process.env.TABLE_NAME;
const OUTPUT_BUCKET_NAME = process.env.OUTPUT_BUCKET_NAME;

exports.handler = async(event) => {
    try {
        const record = event.Records?.[0];
        if (!record) {
            throw new Error("No S3 record found in the event payload.");
        } 

        const sourceBucket = record.s3.bucket.name;
        const rawKey = record.s3.object.key;

        if (!rawKey) {
            console.error("RAW EVENT OBJECT FOR DEBUGGING:", JSON.stringify(event, null, 2));
            throw new Error("The object key extracted from the event is empty.");
        }

        const key = decodeURIComponent(rawKey.replace(/\+/g, " "));

        console.log(`Processing key: ${key} from bucket: ${sourceBucket}`);

        const s3Command = new HeadObjectCommand({
            Bucket: sourceBucket,
            Key: key
        })

        const s3Metadata = await s3Client.send(s3Command) 

        const destinationKey = `processed-${key}`;
        const copySourcePath = `/${sourceBucket}/${encodeURIComponent(key)}`;

        console.log(`Copying file from ${copySourcePath} to bucket ${OUTPUT_BUCKET_NAME} as ${destinationKey}`);

        const copyCommand = new CopyObjectCommand({
            Bucket: OUTPUT_BUCKET_NAME,
            CopySource: copySourcePath,
            Key: destinationKey
        });
        await s3Client.send(copyCommand);
        console.log(`File copied successfully.`);

        const item = {
            ObjectKey: key,
            BucketName: sourceBucket,
            FileSize: s3Metadata.ContentLength,
            ContentType: s3Metadata.ContentType,
            ProcessedAt: new Date().toISOString()
        }

        const dbCommand = new PutCommand({
            TableName: TABLE_NAME,
            Item: item
        })

        await docClient.send(dbCommand);

        console.log(`Successfully indexed metadata for ${key} into DynamoDB.`);

        return {
            statusCode: 200,
            body: JSON.stringify({ message: "File processed, copied, and logged successfully!" })
        };

    } catch (error) {
        console.error("Execution failed:", error);
        throw error;
    }
}